import type { Bot, ExecutionTaskInput } from "@/lib/shared/types";
import { listBots } from "./db";
import { createExecution, executeExecution } from "./execution";
import { runTurn } from "./runtime";
import { readSharedMemory } from "./memory-files";

function plannerBot(bots: Bot[]): Bot {
  return bots.find((bot) => /chief|planner|planning|atlas/i.test(`${bot.title} ${bot.name}`)) ?? bots[0];
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

export async function planAndExecute(input: { name?: string; instruction: string; execute?: boolean }) {
  const instruction = input.instruction?.trim();
  if (!instruction) throw new Error("Provide an instruction.");
  const bots = await listBots();
  if (!bots.length) throw new Error("Create at least one agent before planning.");

  const planner = plannerBot(bots);
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
    '{"executionName":"name","tasks":[{"key":"unique-key","title":"title","description":"specific task","assignedBotId":"existing bot id","dependencies":["other-key"],"maxAttempts":2,"timeoutMs":120000}]}',
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
      }))
      .filter((task) => task.key && task.title && task.description && ids.has(task.assignedBotId));
    if (candidates.length) {
      tasks = candidates;
      if (typeof parsed.executionName === "string" && parsed.executionName.trim()) executionName = parsed.executionName.trim();
    }
  }

  if (!tasks.length) {
    tasks = [
      { key: "analyse", title: "Analyse objective", description: `Analyse this instruction and identify the required evidence, decisions and deliverable:\n${instruction}`, assignedBotId: planner.id },
      { key: "execute", title: "Complete objective", description: `Use the available context and tools to complete the objective:\n${instruction}`, assignedBotId: planner.id, dependencies: ["analyse"] },
      { key: "consolidate", title: "Consolidate result", description: "Combine work into one concise, actionable deliverable and identify unresolved uncertainties.", assignedBotId: planner.id, dependencies: ["execute"] },
    ];
  }

  const execution = await createExecution({ name: executionName, instruction, tasks });
  if (input.execute) void executeExecution(execution.id).catch((error) => console.error("[chief-of-staff]", error));
  return { execution, tasks };
}
