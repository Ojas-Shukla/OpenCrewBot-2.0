import { body, handle } from "@/lib/server/http";
import { createBot } from "@/lib/server/service";
import { DEFAULT_MODEL, listModels } from "@/lib/server/models";
import { listBots, listSkills } from "@/lib/server/db";
import { runTurn } from "@/lib/server/runtime";
import type { ApprovalMode, BotTools } from "@/lib/shared/types";

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

    const [bots, skills, models] = await Promise.all([listBots(), listSkills(), listModels()]);
    const planner = bots.find((bot) => /chief|planner|planning|atlas/i.test(`${bot.title} ${bot.name}`)) ?? bots[0];
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

    const toolsValue = generated?.tools && typeof generated.tools === "object" ? generated.tools as Partial<BotTools> : {};
    const tools: BotTools = {
      webSearch: Boolean(toolsValue.webSearch),
      memory: toolsValue.memory !== false,
      codeMode: Boolean(toolsValue.codeMode),
      browser: Boolean(toolsValue.browser),
      askUser: toolsValue.askUser !== false,
    };
    const approval: ApprovalMode =
      generated?.approval === "full" || generated?.approval === "controlled" ? generated.approval as ApprovalMode : "ask";
    const skillIds = Array.isArray(generated?.skillIds)
      ? generated!.skillIds.filter((id): id is string => typeof id === "string" && skills.some((skill) => skill.id === id))
      : [];
    const fallbackModels = Array.isArray(generated?.fallbackModels)
      ? generated!.fallbackModels.filter((id): id is string => typeof id === "string")
      : [];
    const bot = await createBot({
      name: input.name?.trim() || String(generated?.name ?? "").trim() || "Specialist",
      title: String(generated?.title ?? "").trim() || "General Specialist",
      description: String(generated?.description ?? "").trim() || instruction.slice(0, 240),
      instructions: String(generated?.instructions ?? "").trim() || instruction,
      emoji: String(generated?.emoji ?? "").trim() || "🤖",
      color: /^#[0-9a-f]{6}$/i.test(String(generated?.color ?? "")) ? String(generated!.color) : "#7c5ce7",
      model: input.model?.trim() || (typeof generated?.model === "string" ? generated.model : DEFAULT_MODEL),
      tools,
      approval,
      controlledTools: Array.isArray(generated?.controlledTools) ? generated.controlledTools.filter((id): id is string => typeof id === "string") : [],
      skillIds,
      outputFormat: typeof generated?.outputFormat === "string" ? generated.outputFormat : "Clear findings, assumptions, evidence and next actions",
      fallbackModels,
      pinned: false,
    });
    return { bot };
  });
}
