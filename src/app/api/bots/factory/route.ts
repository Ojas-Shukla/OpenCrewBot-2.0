import { body, handle } from "@/lib/server/http";
import { createBot } from "@/lib/server/service";
import { DEFAULT_MODEL } from "@/lib/server/models";
import type { ApprovalMode, BotTools } from "@/lib/shared/types";

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase()).slice(0, 40);
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = await body<{ instruction: string; name?: string; model?: string }>(request);
    const instruction = input.instruction?.trim();
    if (!instruction) throw new Error("Describe the agent you want to create.");

    const lower = instruction.toLowerCase();
    const name = input.name?.trim() || titleCase(
      instruction.match(/\b(?:named?|called)\s+([a-z][a-z0-9_-]*)/i)?.[1]
        ?? (lower.includes("research") ? "Scout 2" : lower.includes("sales") ? "Prospector" : lower.includes("code") ? "Builder" : "Specialist"),
    );
    const tools: BotTools = {
      webSearch: /\b(research|market|competitor|web|search|lead|audience)\b/.test(lower),
      memory: true,
      codeMode: /\b(data|analysis|code|spreadsheet|financial|model)\b/.test(lower),
      browser: /\b(browser|website|external|navigate|click)\b/.test(lower),
      askUser: true,
    };
    const approval: ApprovalMode = /\b(full access|autonomous)\b/.test(lower)
      ? "full"
      : /\bcontrolled access|pre-approved|limited access\b/.test(lower)
        ? "controlled"
        : "ask";
    const bot = await createBot({
      name,
      title: lower.includes("research") ? "Research" : lower.includes("sales") ? "Sales" : lower.includes("code") ? "Development" : "Specialist",
      description: instruction.slice(0, 240),
      instructions: instruction,
      emoji: "🤖",
      color: "#7c5ce7",
      model: input.model || DEFAULT_MODEL,
      tools,
      approval,
      controlledTools: approval === "controlled" ? ["web_search", "read_page", "crawl_site", "memory"] : [],
      pinned: false,
    });
    return { bot };
  });
}
