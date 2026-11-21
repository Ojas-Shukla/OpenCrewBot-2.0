import type { Bot, ExecutionTaskInput } from "@/lib/shared/types";
import { listBots } from "./db";
import { createExecution, executeExecution } from "./execution";

function botFor(bots: Bot[], terms: string[], fallbackTitle: string): Bot {
  for (const term of terms) {
    const match = bots.find((bot) =>
      `${bot.title} ${bot.name} ${bot.description} ${bot.instructions}`.toLowerCase().includes(term),
    );
    if (match) return match;
  }
  return bots.find((bot) => bot.title.toLowerCase().includes(fallbackTitle)) ?? bots[0];
}

export async function planAndExecute(input: { name?: string; instruction: string; execute?: boolean }) {
  const instruction = input.instruction?.trim();
  if (!instruction) throw new Error("Provide an instruction.");
  const bots = await listBots();
  if (!bots.length) throw new Error("Create at least one agent before planning.");

  const lower = instruction.toLowerCase();
  const planner = botFor(bots, ["planning", "operations", "coordination"], "planning");
  const researcher = botFor(bots, ["research", "analyst", "market"], "research");
  const writer = botFor(bots, ["writing", "content", "marketing"], "writing");
  const developer = botFor(bots, ["development", "engineering", "code", "review"], "development");

  const tasks: ExecutionTaskInput[] = [
    {
      key: "clarify",
      title: "Clarify objective and success criteria",
      description: `Break this request into decisions, constraints, stakeholders and measurable outcomes:\n${instruction}`,
      assignedBotId: planner.id,
    },
  ];

  let researchKey: string | undefined;
  if (/\b(research|market|competitor|audience|github|repository|code|data|sales|campaign|pricing|industry)\b/.test(lower)) {
    researchKey = "research";
    tasks.push({
      key: researchKey,
      title: "Gather and verify relevant evidence",
      description: `Research the facts needed for this objective. Separate verified evidence, assumptions and gaps:\n${instruction}`,
      assignedBotId: /\b(code|github|repository|technical|review)\b/.test(lower) ? developer.id : researcher.id,
      dependencies: ["clarify"],
    });
  }

  if (/\b(campaign|email|presentation|draft|content|report|calendar|strategy|copy)\b/.test(lower)) {
    tasks.push({
      key: "draft",
      title: "Create the requested business deliverable",
      description: `Use the objective and verified research to create the requested deliverable in a useful, concrete format:\n${instruction}`,
      assignedBotId: writer.id,
      dependencies: researchKey ? ["clarify", "research"] : ["clarify"],
    });
  } else if (/\b(code|github|repository|technical|review|development)\b/.test(lower)) {
    tasks.push({
      key: "development",
      title: "Analyse implementation and provide a prioritized plan",
      description: `Inspect the relevant repository or code context, identify issues and propose concrete, prioritized changes:\n${instruction}`,
      assignedBotId: developer.id,
      dependencies: ["clarify", ...(researchKey ? ["research"] : [])],
    });
  } else if (/\b(data|sales|spreadsheet|revenue|conversion|analysis|financial|budget)\b/.test(lower)) {
    tasks.push({
      key: "analysis",
      title: "Analyse data and quantify opportunities",
      description: `Perform the requested business analysis, state calculations and assumptions, and recommend actions:\n${instruction}`,
      assignedBotId: researcher.id,
      dependencies: ["clarify", ...(researchKey ? ["research"] : [])],
    });
  }

  const deliverableDependencies = tasks.filter((task) => task.key !== "clarify").map((task) => task.key);
  tasks.push({
    key: "consolidate",
    title: "Consolidate the final deliverable",
    description: `Combine completed work into one coherent result. Resolve conflicts, cite evidence, state assumptions and list any approvals or next actions:\n${instruction}`,
    assignedBotId: planner.id,
    dependencies: ["clarify", ...(deliverableDependencies.length ? deliverableDependencies : [])],
  });

  const execution = await createExecution({
    name: input.name?.trim() || instruction.slice(0, 120),
    instruction,
    tasks,
  });
  if (input.execute) void executeExecution(execution.id).catch((error) => console.error("[chief-of-staff]", error));
  return { execution, tasks };
}
