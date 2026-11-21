import type { Bot, ExecutionTaskInput } from "@/lib/shared/types";
import { getSetting, listBots, setSetting } from "./db";
import { createExecution, executeExecution } from "./execution";
import { runTurn } from "./runtime";
import { readSharedMemory } from "./memory-files";
import { InputError } from "./errors";

export async function chiefOfStaffConfiguration() {
  const bots = await listBots();
  const configuredId = await getSetting<string>("chiefOfStaffBotId");
  const planner = bots.find((bot) => bot.id === configuredId) ?? bots[0];
  return { plannerBotId: planner?.id ?? null, bots };
}

export async function setChiefOfStaffBot(botId: string) {
  if (!(await listBots()).some((bot) => bot.id === botId)) throw new Error("Selected planner agent does not exist.");
  await setSetting("chiefOfStaffBotId", botId);
}

function parsePlan(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function planAndExecute(input: { name?: string; instruction: string; execute?: boolean; plannerBotId?: string }) {
  const instruction = input.instruction?.trim();
  if (!instruction) throw new Error("Provide an instruction.");
  const bots = await listBots();
  if (!bots.length) throw new Error("Create at least one agent before planning.");

  const configured = await getSetting<string>("chiefOfStaffBotId");
  const plannerId = input.plannerBotId || configured;
  const planner = bots.find((bot) => bot.id === plannerId) ?? bots[0];
  if (input.plannerBotId && !bots.some((bot) => bot.id === input.plannerBotId)) throw new InputError("Selected planner agent does not exist.");
  const projectName = input.name?.trim() || "default";
  const shared = readSharedMemory("project", projectName).trim();
  const roster = bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    title: bot.title,
    description: bot.description,
    instructions: bot.instructions,
    skillIds: bot.skillIds ?? [],
  }));
  const prompt = [
    "You are the Chief of Staff. Produce one dependency-aware execution plan.",
    "Return only JSON:",
    '{"executionName":"name","tasks":[{"key":"unique-key","title":"title","description":"specific task","assignedBotId":"existing bot id","dependencies":["other-key"],"maxAttempts":2,"timeoutMs":120000,"model":"configured model id"}]}',
    `Existing agents:\n${JSON.stringify(roster)}`,
    shared ? `Shared project memory:\n${shared.slice(0, 16000)}` : "",
    `Instruction:\n${instruction}`,
    "Assign work according to actual capabilities. Independent work may have no dependencies. Include a final consolidation task.",
  ].filter(Boolean).join("\n\n");

  let tasks: ExecutionTaskInput[] = [];
  let executionName = input.name?.trim() || instruction.slice(0, 120);
  const reply = await runTurn({
    bot: planner,
    conversationId: `chief-of-staff:${Date.now()}`,
    content: prompt,
  });
  const text = reply?.parts.filter((part) => part.kind === "text").map((part) => part.text).join("\n") ?? "";
  const parsed = parsePlan(text);
  if (parsed && Array.isArray(parsed.tasks)) {
    const ids = new Set(bots.map((bot) => bot.id));
    const candidates = parsed.tasks
      .filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === "object")
      .map((task) => ({
        key: String(task.key ?? "").trim(),
        title: String(task.title ?? "").trim(),
        description: String(task.description ?? "").trim(),
        assignedBotId: String(task.assignedBotId ?? "").trim(),
        dependencies: Array.isArray(task.dependencies) ? task.dependencies.map(String) : [],
        maxAttempts: Number.isInteger(task.maxAttempts) ? Number(task.maxAttempts) : 2,
        timeoutMs: Number.isInteger(task.timeoutMs) ? Number(task.timeoutMs) : 120000,
        model: typeof task.model === "string" ? task.model : undefined,
      }))
      .filter((task) => task.key && task.title && task.description && ids.has(task.assignedBotId));
    if (candidates.length) {
      tasks = candidates;
      if (typeof parsed.executionName === "string" && parsed.executionName.trim()) executionName = parsed.executionName.trim();
    }
  }

  if (!tasks.length) {
    const specialists = bots.filter((bot) => bot.id !== planner.id);
    const selected = specialists.length ? specialists : [planner];
    tasks = selected.map((bot) => ({
      key: `agent-${bot.id}`,
      title: `Independent contribution: ${bot.title || bot.name}`,
      description: [
        `Contribute from your configured role as ${bot.title || bot.name}.`,
        bot.description,
        bot.instructions,
        `Objective:\n${instruction}`,
      ].filter(Boolean).join("\n\n"),
      assignedBotId: bot.id,
      maxAttempts: 2,
    }));
    tasks.push({
      key: "consolidate",
      title: "Consolidate team contributions",
      description: "Review every independent contribution, identify conflicts and gaps, and assemble one final deliverable.",
      assignedBotId: planner.id,
      dependencies: selected.map((bot) => `agent-${bot.id}`),
    });
  }

  const execution = await createExecution({ name: executionName, instruction, tasks, projectId: projectName });
  if (input.execute) void executeExecution(execution.id).catch((error) => console.error("[chief-of-staff]", error));
  return { execution, tasks };
}
