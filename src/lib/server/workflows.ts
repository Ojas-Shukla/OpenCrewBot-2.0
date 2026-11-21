import { randomUUID } from "node:crypto";
import type { ExecutionRun, ExecutionTaskInput, ScheduledWorkflow, WorkflowTemplate } from "@/lib/shared/types";
import { InputError } from "./errors";
import {
  getBot,
  claimWorkflowSchedule,
  getWorkflowTemplate,
  listScheduledWorkflows,
  listWorkflowRuns,
  listWorkflowTemplates,
  saveScheduledWorkflow,
  saveWorkflowRun,
  saveWorkflowTemplate,
} from "./db";
import { createExecution, executeExecution } from "./execution";
import { nextCronRun, validateCron } from "./cron";

function validateTaskTemplates(tasks: ExecutionTaskInput[]) {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 30) throw new InputError("A workflow needs between 1 and 30 task templates.");
  const keys = tasks.map((task) => task.key?.trim());
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) throw new InputError("Every workflow task needs a unique key.");
  for (const task of tasks) {
    if (!task.title?.trim() || !task.description?.trim()) throw new InputError("Every workflow task needs a title and description.");
  }
}

export async function createWorkflowTemplate(input: { name: string; description: string; instruction: string; taskTemplates: ExecutionTaskInput[] }): Promise<WorkflowTemplate> {
  if (!input.name?.trim() || !input.instruction?.trim()) throw new InputError("Workflow name and instruction are required.");
  validateTaskTemplates(input.taskTemplates);
  for (const task of input.taskTemplates) {
    if (!(await getBot(task.assignedBotId))) throw new InputError(`Assigned agent "${task.assignedBotId}" does not exist.`);
  }
  const now = new Date().toISOString();
  const workflow: WorkflowTemplate = {
    id: randomUUID().slice(0, 8),
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    instruction: input.instruction.trim(),
    taskTemplates: input.taskTemplates,
    createdAt: now,
    updatedAt: now,
  };
  await saveWorkflowTemplate(workflow);
  return workflow;
}

export function workflows() {
  return listWorkflowTemplates();
}

export async function createScheduledWorkflow(input: { name: string; workflowId: string; cron: string }): Promise<ScheduledWorkflow> {
  if (!input.name?.trim()) throw new InputError("Schedule name is required.");
  if (!input.cron?.trim()) throw new InputError("A cron expression is required.");
  try {
    validateCron(input.cron.trim());
  } catch (error) {
    throw new InputError(error instanceof Error ? error.message : "Invalid cron expression.");
  }
  if (!(await getWorkflowTemplate(input.workflowId))) throw new InputError("Workflow template not found.");
  const now = new Date().toISOString();
  const schedule: ScheduledWorkflow = {
    id: randomUUID().slice(0, 8),
    name: input.name.trim(),
    workflowId: input.workflowId,
    cron: input.cron.trim(),
    status: "active",
    nextRunAt: nextCronRun(input.cron.trim()).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
  await saveScheduledWorkflow(schedule);
  return schedule;
}

export async function setScheduledWorkflowStatus(id: string, status: "active" | "paused"): Promise<ScheduledWorkflow> {
  const schedule = await listScheduledWorkflows().then((items) => items.find((item) => item.id === id));
  if (!schedule) throw new InputError("Scheduled workflow not found.");
  const updated = {
    ...schedule,
    status,
    nextRunAt: status === "active" ? (schedule.nextRunAt ?? nextCronRun(schedule.cron).toISOString()) : schedule.nextRunAt,
    updatedAt: new Date().toISOString(),
  };
  await saveScheduledWorkflow(updated);
  return updated;
}

export function scheduledWorkflows() {
  return listScheduledWorkflows();
}

export async function runScheduledWorkflow(id: string): Promise<ExecutionRun> {
  const schedule = (await listScheduledWorkflows()).find((item) => item.id === id);
  if (!schedule) throw new InputError("Scheduled workflow not found.");
  if (schedule.status !== "active") throw new InputError("The scheduled workflow is paused.");
  const workflow = await getWorkflowTemplate(schedule.workflowId);
  if (!workflow) throw new InputError("Workflow template not found.");
  const execution = await createExecution({
    name: `${schedule.name}: ${workflow.name}`,
    instruction: workflow.instruction,
    tasks: workflow.taskTemplates,
    projectId: workflow.id,
  });
  await saveWorkflowRun({ ...execution, workflowId: workflow.id });
  void executeExecution(execution.id).catch((error) => console.error("[scheduled-workflow]", error));
  const now = new Date().toISOString();
  await saveScheduledWorkflow({ ...schedule, lastRunAt: now, lastRunStatus: "running", updatedAt: now });
  return execution;
}

export function workflowRuns(workflowId?: string) {
  return listWorkflowRuns(workflowId);
}

const g = globalThis as unknown as { __opencrewbotScheduler?: { started: boolean } };

export function startWorkflowScheduler(): void {
  const state = g.__opencrewbotScheduler ??= { started: false };
  if (state.started) return;
  state.started = true;
  const tick = async () => {
    const now = Date.now();
    for (const schedule of await listScheduledWorkflows()) {
      if (schedule.status !== "active" || !schedule.nextRunAt || Date.parse(schedule.nextRunAt) > now) continue;
      try {
        const nowIso = new Date(now).toISOString();
        const leaseUntil = new Date(now + 2 * 60 * 1000).toISOString();
        if (!(await claimWorkflowSchedule(schedule.id, nowIso, leaseUntil))) continue;
        await runScheduledWorkflow(schedule.id);
        const refreshed = (await listScheduledWorkflows()).find((item) => item.id === schedule.id);
        if (!refreshed || refreshed.status !== "active") continue;
        await saveScheduledWorkflow({
          ...refreshed,
          nextRunAt: nextCronRun(schedule.cron).toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        await saveScheduledWorkflow({ ...schedule, status: "paused", updatedAt: new Date().toISOString() });
        console.error("[workflow-scheduler]", error);
      }
    }
  };
  void tick();
  setInterval(() => void tick(), 30 * 1000);
}
