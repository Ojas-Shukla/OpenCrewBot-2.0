import { randomUUID } from "node:crypto";
import type { ExecutionRun, ExecutionTask, ExecutionTaskInput } from "@/lib/shared/types";
import { getBot, getExecutionRun, listExecutionRuns, listExecutionTasks, saveExecutionRun, saveExecutionTask, writeAuditEvent } from "./db";
import { InputError } from "./errors";
import { runTurn, stopConversation } from "./runtime";
import { readSharedMemory } from "./memory-files";
import { routeModelForTask } from "./models";

const activeRuns = new Set<string>();

function audit(type: string, data: unknown) {
  return writeAuditEvent({ id: randomUUID(), type, createdAt: new Date().toISOString(), data });
}

function assertAcyclic(tasks: Array<ExecutionTaskInput & { id: string }>) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const dependency of task.dependencies ?? []) {
      if (!byId.has(dependency)) throw new InputError(`Task "${task.title}" depends on an unknown task.`);
      if (dependency === task.id) throw new InputError(`Task "${task.title}" cannot depend on itself.`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new InputError("Task dependencies contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

export async function createExecution(input: { name: string; instruction: string; tasks: ExecutionTaskInput[] }): Promise<ExecutionRun> {
  const name = input.name?.trim();
  const instruction = input.instruction?.trim();
  if (!name || name.length > 120) throw new InputError("Execution name is required and must be under 120 characters.");
  if (!instruction || instruction.length > 20000) throw new InputError("Provide an instruction under 20,000 characters.");
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 30) throw new InputError("An execution needs between 1 and 30 tasks.");

  const createdAt = new Date().toISOString();
  const keys = input.tasks.map((task) => task.key?.trim());
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) {
    throw new InputError("Every task needs a unique, non-empty key.");
  }
  const idByKey = new Map(input.tasks.map((task) => [task.key.trim(), randomUUID()]));
  const normalized = input.tasks.map((task) => ({
    ...task,
    id: idByKey.get(task.key.trim())!,
    dependencies: (task.dependencies ?? []).map((dependency) => idByKey.get(dependency.trim()) ?? dependency.trim()),
  }));
  assertAcyclic(normalized);
  for (const task of normalized) {
    if (!task.title?.trim() || !task.description?.trim()) throw new InputError("Every task needs a title and description.");
    if (!(await getBot(task.assignedBotId))) throw new InputError(`Assigned agent "${task.assignedBotId}" does not exist.`);
    if (task.maxAttempts !== undefined && (!Number.isInteger(task.maxAttempts) || task.maxAttempts < 1 || task.maxAttempts > 5)) {
      throw new InputError("maxAttempts must be an integer from 1 to 5.");
    }
    if (task.timeoutMs !== undefined && (!Number.isInteger(task.timeoutMs) || task.timeoutMs < 1000 || task.timeoutMs > 900000)) {
      throw new InputError("timeoutMs must be an integer from 1,000 to 900,000.");
    }
  }

  const runId = randomUUID();
  const tasks: ExecutionTask[] = normalized.map((task) => ({
    id: task.id,
    runId,
    title: task.title.trim(),
    description: task.description.trim(),
    assignedBotId: task.assignedBotId,
    dependencies: task.dependencies ?? [],
    status: "pending",
    attempts: 0,
    maxAttempts: task.maxAttempts ?? 2,
    timeoutMs: task.timeoutMs,
    createdAt,
  }));
  const run: ExecutionRun = { id: runId, name, instruction, status: "planned", taskIds: tasks.map((task) => task.id), createdAt };
  await saveExecutionRun(run);
  for (const task of tasks) await saveExecutionTask(task);
  await audit("execution.created", { runId, taskIds: run.taskIds, taskCount: tasks.length });
  return run;
}

export async function getExecution(id: string) {
  const run = await getExecutionRun(id);
  if (!run) return null;
  return { run, tasks: await listExecutionTasks(id) };
}

export async function executionHistory() {
  const runs = await listExecutionRuns();
  return Promise.all(runs.map(async (run) => ({ run, tasks: await listExecutionTasks(run.id) })));
}

export async function cancelExecution(id: string): Promise<ExecutionRun> {
  const run = await getExecutionRun(id);
  if (!run) throw new InputError("Execution not found.");
  if (run.status === "completed" || run.status === "cancelled") return run;
  const tasks = await listExecutionTasks(id);
  for (const task of tasks) {
    if (task.status !== "completed") {
      task.status = "cancelled";
      task.error = "Cancelled by the user.";
      task.completedAt = new Date().toISOString();
      await saveExecutionTask(task);
    }
  }
  await stopConversation(`execution:${id}`);
  run.status = "cancelled";
  run.completedAt = new Date().toISOString();
  await saveExecutionRun(run);
  await audit("execution.cancelled", { runId: id });
  return run;
}

function outputOf(message: Awaited<ReturnType<typeof runTurn>>): string {
  if (!message) return "";
  return message.parts.filter((part) => part.kind === "text").map((part) => part.text).join("\n").trim();
}

/** Execute every dependency-ready task concurrently; retries are bounded per task. */
export async function executeExecution(id: string): Promise<void> {
  if (activeRuns.has(id)) return;
  const run = await getExecutionRun(id);
  if (!run) throw new InputError("Execution not found.");
  if (run.status === "completed" || run.status === "cancelled") return;
  activeRuns.add(id);
  try {
  // A POST /run on a failed execution is an explicit retry. Preserve successful
  // prerequisite outputs, but reopen failed/blocked tasks with a fresh retry budget.
  const persistedTasks = await listExecutionTasks(id);
  if (run.status === "failed") {
    for (const task of persistedTasks) {
      if (task.status === "failed" || task.status === "blocked") {
        task.status = "pending";
        task.attempts = 0;
        task.output = undefined;
        task.error = undefined;
        task.startedAt = undefined;
        task.completedAt = undefined;
        await saveExecutionTask(task);
      }
    }
  }
  // A task left running by a process crash is safe to retry: its last result
  // was never committed as completed. Keep its attempt count for bounded retry.
  for (const task of persistedTasks) {
    if (task.status === "running") {
      task.status = "pending";
      task.error = "Recovered after an interrupted server process.";
      if (task.attempts >= task.maxAttempts) task.attempts = Math.max(0, task.maxAttempts - 1);
      await saveExecutionTask(task);
    }
  }
  run.status = "running";
  run.startedAt ??= new Date().toISOString();
  await saveExecutionRun(run);
  await audit("execution.started", { runId: id });

    let tasks = await listExecutionTasks(id);
    while (tasks.some((task) => task.status === "pending" || task.status === "running")) {
      if ((await getExecutionRun(id))?.status === "cancelled") break;
      const completed = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id));
      let changed = false;

      // A task whose prerequisite failed cannot run; record that explicitly.
      for (const task of tasks.filter((item) => item.status === "pending")) {
        const prerequisites = tasks.filter((item) => task.dependencies.includes(item.id));
        if (prerequisites.some((item) => ["failed", "blocked", "cancelled"].includes(item.status))) {
          task.status = "blocked";
          task.error = "A prerequisite task did not complete.";
          task.completedAt = new Date().toISOString();
          await saveExecutionTask(task);
          changed = true;
        }
      }

      const ready = tasks.filter((task) => task.status === "pending" && task.dependencies.every((dep) => completed.has(dep)));
      if (ready.length) {
        changed = true;
        await Promise.all(ready.map(async (task) => {
          const bot = await getBot(task.assignedBotId);
          if (!bot) {
            task.status = "failed";
            task.error = "Assigned agent was deleted before execution.";
            task.completedAt = new Date().toISOString();
            await saveExecutionTask(task);
            return;
          }
          task.status = "running";
          task.startedAt = new Date().toISOString();
          await saveExecutionTask(task);
          await audit("execution.task.started", { runId: id, taskId: task.id, botId: bot.id });

          const priorOutputs = tasks
            .filter((candidate) => task.dependencies.includes(candidate.id))
            .map((candidate) => `### ${candidate.title}\n${candidate.output ?? "(No output)"}`)
            .join("\n\n");
          const prompt = [
            `You are executing one assigned task as part of the workflow: ${run.name}.`,
            `Overall objective: ${run.instruction}`,
            `Task: ${task.title}`,
            task.description,
            priorOutputs ? `Completed prerequisite work:\n${priorOutputs}` : "",
            `Shared project memory:\n${readSharedMemory("project", id).trim() || "(empty)"}`,
            "Complete only this task. Make your output self-contained, identify uncertainty, and do not claim actions you did not perform.",
          ].filter(Boolean).join("\n\n");
          const routedBot = {
            ...bot,
            model: await routeModelForTask(bot, `${task.title}\n${task.description}`),
          };

          let succeeded = false;
          while (task.attempts < task.maxAttempts && !succeeded) {
            task.attempts += 1;
            let message: Awaited<ReturnType<typeof runTurn>> | null = null;
            const conversationId = `execution:${id}`;
            const turn = runTurn({ bot: routedBot, conversationId, content: prompt });
            if (task.timeoutMs) {
              const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), task.timeoutMs));
              message = await Promise.race([turn, timeout]);
              if (!message) {
                await stopConversation(conversationId);
                task.error = `Task timed out after ${task.timeoutMs} milliseconds.`;
                continue;
              }
            } else {
              message = await turn;
            }
            const output = outputOf(message);
            if (message?.status === "done" && output) {
              task.output = output;
              task.status = "completed";
              succeeded = true;
            } else {
              task.error = message?.error ?? (message ? "Agent returned no text output." : "Execution was interrupted before the agent started.");
            }
          }
          if (!succeeded) task.status = "failed";
          task.completedAt = new Date().toISOString();
          await saveExecutionTask(task);
          await audit(`execution.task.${task.status}`, { runId: id, taskId: task.id, attempts: task.attempts, error: task.error });
        }));
        tasks = await listExecutionTasks(id);
      }

      if (!changed) {
        const pending = tasks.filter((task) => task.status === "pending");
        if (pending.length) {
          for (const task of pending) {
            task.status = "blocked";
            task.error = "Task could not become ready; check its dependencies.";
            task.completedAt = new Date().toISOString();
            await saveExecutionTask(task);
          }
          tasks = await listExecutionTasks(id);
        }
        break;
      }
    }

    tasks = await listExecutionTasks(id);
    run.status = tasks.every((task) => task.status === "completed") ? "completed" : "failed";
    if (run.status === "failed") run.error = "One or more tasks failed or were blocked. Inspect task-level errors and retry the execution.";
    run.completedAt = new Date().toISOString();
    await saveExecutionRun(run);
    await audit(`execution.${run.status}`, { runId: id });
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.completedAt = new Date().toISOString();
    await saveExecutionRun(run);
    await audit("execution.failed", { runId: id, error: run.error });
    throw error;
  } finally {
    activeRuns.delete(id);
  }
}
