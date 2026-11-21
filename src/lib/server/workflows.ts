import { randomUUID } from "node:crypto";
import type { ExecutionRun, ExecutionTaskInput, ScheduledWorkflow, WorkflowTemplate } from "@/lib/shared/types";
import { InputError } from "./errors";
import { getBot, getWorkflowTemplate, listScheduledWorkflows, listWorkflowTemplates, saveScheduledWorkflow, saveWorkflowTemplate } from "./db";
import { createExecution, executeExecution } from "./execution";
import { listWorkflowRuns, saveWorkflowRun } from "./db";

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
  if (!(await getWorkflowTemplate(input.workflowId))) throw new InputError("Workflow template not found.");
  const now = new Date().toISOString();
  const schedule: ScheduledWorkflow = {
    id: randomUUID().slice(0, 8),
    name: input.name.trim(),
    workflowId: input.workflowId,
    cron: input.cron.trim(),
    status: "active",
    nextRunAt: nextRunAt(input.cron.trim()),
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
    nextRunAt: status === "active" ? (schedule.nextRunAt ?? nextRunAt(schedule.cron)) : schedule.nextRunAt,
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

function nextRunAt(cron: string, from = new Date()): string {
  if (cron === "@hourly") return new Date(from.getTime() + 60 * 60 * 1000).toISOString();
  if (cron === "@daily") return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const interval = cron.match(/^\\*\\/(\d+) \* \* \* \*$/);
  if (interval) return new Date(from.getTime() + Number(interval[1]) * 60 * 1000).toISOString();
  if (/^\d+ \* \* \* \*$/.test(cron)) return new Date(from.getTime() + 60 * 60 * 1000).toISOString();
  if (/^\d+ \d+ \* \* \*$/.test(cron)) return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return new Date(from.getTime() + 60 * 60 * 1000).toISOString();
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
        await runScheduledWorkflow(schedule.id);
        const next = nextRunAt(schedule.cron);
        await saveScheduledWorkflow({ ...schedule, nextRunAt: next, updatedAt: new Date().toISOString() });
      } catch (error) {
        await saveScheduledWorkflow({
          ...schedule,
          status: "paused",
          updatedAt: new Date().toISOString(),
        });
        console.error("[workflow-scheduler]", error);
      }
    }
  };
  void tick();
  setInterval(() => void tick(), 30 * 1000);
}
