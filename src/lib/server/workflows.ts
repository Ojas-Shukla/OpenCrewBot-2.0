import { randomUUID } from "node:crypto";
import type { ExecutionTaskInput, ScheduledWorkflow, WorkflowTemplate } from "@/lib/shared/types";
import { InputError } from "./errors";
import { getBot, getWorkflowTemplate, listScheduledWorkflows, listWorkflowTemplates, saveScheduledWorkflow, saveWorkflowTemplate } from "./db";

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
    createdAt: now,
    updatedAt: now,
  };
  await saveScheduledWorkflow(schedule);
  return schedule;
}

export async function setScheduledWorkflowStatus(id: string, status: "active" | "paused"): Promise<ScheduledWorkflow> {
  const schedule = await listScheduledWorkflows().then((items) => items.find((item) => item.id === id));
  if (!schedule) throw new InputError("Scheduled workflow not found.");
  const updated = { ...schedule, status, updatedAt: new Date().toISOString() };
  await saveScheduledWorkflow(updated);
  return updated;
}

export function scheduledWorkflows() {
  return listScheduledWorkflows();
}
