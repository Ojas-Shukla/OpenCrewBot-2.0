import { body, handle } from "@/lib/server/http";
import { createBot } from "@/lib/server/service";
import { listModels } from "@/lib/server/models";
import { listBots, listSkills } from "@/lib/server/db";
import { runTurn } from "@/lib/server/runtime";
import type { ApprovalMode, BotTools } from "@/lib/shared/types";
import { getSetting } from "@/lib/server/db";
import { InputError } from "@/lib/server/errors";
import { z } from "zod";

const AgentDefinition = z.object({
  name: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  instructions: z.string().trim().min(1).max(8000),
  emoji: z.string().trim().min(1).max(8),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  model: z.string().trim().min(1),
  tools: z.object({
    webSearch: z.boolean(),
    memory: z.boolean(),
    codeMode: z.boolean(),
    browser: z.boolean(),
    askUser: z.boolean(),
  }),
  approval: z.enum(["ask", "controlled", "full"]),
  controlledTools: z.array(z.string().min(1)).max(30),
  skillIds: z.array(z.string().min(1)).max(30),
  outputFormat: z.string().trim().min(1).max(1000),
  fallbackModels: z.array(z.string().trim().min(1)).max(10),
});

function parseAgent(text: string): Record<string, unknown> | null {
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

export async function POST(request: Request) {
  return handle(async () => {
    const input = await body<{ instruction: string; name?: string; model?: string }>(request);
    const instruction = input.instruction?.trim();
    if (!instruction) throw new Error("Describe the agent you want to create.");

    const [bots, skills, models, plannerId] = await Promise.all([
      listBots(),
      listSkills(),
      listModels(),
      getSetting<string>("chiefOfStaffBotId"),
    ]);
    const planner = bots.find((bot) => bot.id === plannerId) ?? bots[0];
    let generated: Record<string, unknown> | null = null;
    if (planner) {
      const reply = await runTurn({
        bot: planner,
        conversationId: `agent-factory:${Date.now()}`,
        content: [
          "Create a complete agent configuration for this request.",
          "Return only JSON:",
          '{"name":"unique name","title":"role","description":"summary","instructions":"persona and operating rules","emoji":"emoji","color":"hex color","model":"model id","tools":{"webSearch":true,"memory":true,"codeMode":false,"browser":false,"askUser":true},"approval":"ask|controlled|full","controlledTools":["tool names"],"skillIds":["skill ids"],"outputFormat":"expected deliverable format","fallbackModels":["model ids"]}',
          `Available models:\n${JSON.stringify(models.slice(0, 40).map((model) => model.id))}`,
          `Available skills:\n${JSON.stringify(skills.map((skill) => ({ id: skill.id, name: skill.name, category: skill.category })))}`,
          `Request:\n${instruction}`,
        ].join("\n\n"),
      });
      const text = reply?.parts.filter((part) => part.kind === "text").map((part) => part.text).join("\n") ?? "";
      generated = parseAgent(text);
    }

    if (!generated) {
      throw new InputError("The configured model did not return a valid agent definition. Retry or provide a model that supports structured JSON output.");
    }
    const definition = AgentDefinition.safeParse(generated);
    if (!definition.success) {
      throw new InputError(`Generated agent configuration is invalid: ${definition.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", ")}.`);
    }
    const modelIds = new Set(models.map((model) => model.id));
    const requestedModel = input.model?.trim() || definition.data.model;
    if (!modelIds.has(requestedModel)) throw new InputError(`Model "${requestedModel}" is not available in the configured model catalog.`);
    const invalidFallback = definition.data.fallbackModels.filter((model) => !modelIds.has(model));
    if (invalidFallback.length) throw new InputError(`Unavailable fallback models: ${invalidFallback.join(", ")}.`);
    const availableSkillIds = new Set(skills.map((skill) => skill.id));
    const invalidSkills = definition.data.skillIds.filter((id) => !availableSkillIds.has(id));
    if (invalidSkills.length) throw new InputError(`Unknown skills: ${invalidSkills.join(", ")}.`);
    const tools: BotTools = definition.data.tools;
    const approval: ApprovalMode = definition.data.approval;
    const bot = await createBot({
      name: input.name?.trim() || definition.data.name,
      title: definition.data.title,
      description: definition.data.description,
      instructions: definition.data.instructions,
      emoji: definition.data.emoji,
      color: definition.data.color,
      model: requestedModel,
      tools,
      approval,
      controlledTools: definition.data.controlledTools,
      skillIds: definition.data.skillIds,
      outputFormat: definition.data.outputFormat,
      fallbackModels: definition.data.fallbackModels,
      pinned: false,
    });
    return { bot };
  });
}
