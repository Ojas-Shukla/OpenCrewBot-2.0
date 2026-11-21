// Group rooms: decide who answers, give each bot the part of the room it
// hasn't seen, and let a bot hand off to a teammate by @mentioning them.
import { randomUUID } from "node:crypto";
import type { Bot, ChatMessage, Room, RouteNote } from "@/lib/shared/types";
import { listBots, listMessages, listCollaborationRecords, saveCollaborationRecord } from "./db";
import { pickResponders } from "./jev";
import { runTurn, stopEpochOf } from "./runtime";
import { readSharedMemory } from "./memory-files";
import { isChallengeContent, parseReviewFindings, type StructuredReviewFindings } from "./execution-policy";

export { isChallengeContent, parseReviewFindings, type StructuredReviewFindings };

/** How many bot-to-bot @mention hops one message from the person can start. */
const MAX_HANDOFF_DEPTH = 2;

export function roomConversationId(roomId: string) {
  return `room:${roomId}`;
}

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((p) => p.kind === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n")
    .trim();
}

async function recordCollaboration(
  room: Room,
  fromBotId: string,
  type: "handoff" | "intermediate" | "challenge" | "verification" | "review",
  content: string,
  toBotId?: string,
) {
  await saveCollaborationRecord({
    id: randomUUID(),
    roomId: room.id,
    fromBotId,
    toBotId,
    type,
    content,
    status: "resolved",
    createdAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
  });
}

function mentionsIn(text: string, members: Bot[]): Bot[] {
  const handles = new Set([...text.matchAll(/@([a-z0-9_-]+)/gi)].map((m) => m[1].toLowerCase()));
  return members.filter((b) => handles.has(b.handle) || handles.has(b.name.toLowerCase()));
}

function authorName(message: ChatMessage, bots: Map<string, Bot>): string {
  if (message.role === "user") return "Person";
  return bots.get(message.botId ?? "")?.name ?? "A former member";
}

export async function executeReviewerAudit(
  room: Room,
  reviewer: Bot,
  members: Bot[],
  summary: string,
  conversationId: string,
): Promise<{ reviewMessage: ChatMessage | null; findings: StructuredReviewFindings | null }> {
  const reviewPrompt = [
    `[EXPLICIT REVIEW STEP: EVIDENCE AUDIT in "${room.name}"]`,
    `You are the designated reviewer (${reviewer.name}, @${reviewer.handle}). Your responsibility is a rigorous audit of the evidence, assumptions, calculations, and claims produced by your teammates.`,
    "Do NOT produce superficial praise. Actively verify claims against evidence, detect any unsupported numbers, unverified statements, or internal contradictions.",
    "You MUST format your findings as structured JSON inside ```json ... ```:",
    JSON.stringify(
      {
        verdict: "challenge",
        targetBotHandle: members.find((m) => m.id !== reviewer.id)?.handle || "agent",
        claimsAudited: ["Claim 1 audited", "Claim 2 audited"],
        evidenceAssessment: "Detailed critique of evidence, citations, and calculations",
        materialDefects: ["Contradiction in pricing", "Unsupported revenue claim"],
        recommendations: "Specific corrections required from the agent",
        confidence: 0.95,
      },
      null,
      2,
    ),
    "Follow the JSON block with your plain text teammate commentary explaining your audit.",
    `Contributions under audit:\n${summary}`,
  ].join("\n\n");

  const reviewMessage = await runTurn({
    bot: reviewer,
    conversationId,
    content: reviewPrompt,
    route: { by: "handoff" },
  });

  if (!reviewMessage || reviewMessage.status !== "done") {
    return { reviewMessage, findings: null };
  }

  const findings = parseReviewFindings(messageText(reviewMessage), members);
  return { reviewMessage, findings };
}

/** Everything in the room since this bot last spoke (at most the last 30 lines). */
function catchUp(history: ChatMessage[], bot: Bot, bots: Map<string, Bot>): string[] {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].botId === bot.id && history[i].role === "bot") {
      start = i + 1;
      break;
    }
  }
  return history
    .slice(start)
    .filter((m) => m.role !== "notice" && m.status !== "streaming")
    .slice(-30)
    .map((m) => `${authorName(m, bots)}: ${messageText(m) || "(no text)"}`);
}

function roomPrompt(room: Room, bot: Bot, members: Bot[], lines: string[], handoff: boolean, collaboration: string): string {
  const roster = members
    .map((b) => `- ${b.name} (@${b.handle})${b.title ? `, ${b.title}` : ""}${b.id === bot.id ? " (you)" : ""}`)
    .join("\n");
  const sharedMemory = readSharedMemory("room", room.id).trim();
  return [
    `[Group room "${room.name}"${room.topic ? `, topic: ${room.topic}` : ""}]`,
    `Members:\n${roster}`,
    sharedMemory ? `Shared room memory:\n${sharedMemory.slice(0, 16 * 1024)}` : "",
    collaboration ? `Structured collaboration records:\n${collaboration}` : "",
    `New in the room since your last message:\n${lines.join("\n") || "(nothing new)"}`,
    "---",
    handoff
      ? `A teammate @mentioned you. Do the part they asked of you, as ${bot.name}.`
      : `Reply to the latest message as ${bot.name}.`,
    "Add only your part; don't repeat what teammates already said. To hand something to a teammate, @mention their handle.",
  ].join("\n\n");
}

async function decideResponders(room: Room, members: Bot[], text: string, history: ChatMessage[], bots: Map<string, Bot>) {
  const lead = members.find((b) => b.id === room.leadId) ?? members[0];
  if (/@(everyone|all)\b/i.test(text) || room.responder === "everyone") {
    return { bots: members, route: { by: "everyone" } as RouteNote };
  }
  const mentioned = mentionsIn(text, members);
  if (mentioned.length) return { bots: mentioned, route: { by: "mention" } as RouteNote };
  if (room.responder === "auto") {
    const lines = history.slice(-9, -1).map((m) => `${authorName(m, bots)}: ${messageText(m).slice(0, 300)}`);
    const pick = await pickResponders(room, members, lines, text);
    if (pick) {
      return {
        bots: members.filter((b) => pick.botIds.includes(b.id)),
        route: { by: "jev", confidence: pick.confidence } as RouteNote,
      };
    }
  }
  return { bots: lead ? [lead] : [], route: { by: "lead" } as RouteNote };
}

/** Handle the person's new room message: route responders in parallel, then allow bounded hand-offs. */
export async function runRoom(room: Room, userMessage: ChatMessage): Promise<void> {
  const allBots = await listBots();
  const bots = new Map(allBots.map((b) => [b.id, b]));
  const members = room.memberIds.map((id) => bots.get(id)).filter((b): b is Bot => Boolean(b));
  if (!members.length) return;

  const conversationId = roomConversationId(room.id);
  const epoch = stopEpochOf(conversationId);
  const history = await listMessages(conversationId, 60);
  const collaborationRecords = (await listCollaborationRecords(room.id, 30))
    .map((record) => `[${record.type}] ${record.fromBotId}${record.toBotId ? ` -> ${record.toBotId}` : ""}: ${record.content}`)
    .join("\n");
  const { bots: responders, route } = await decideResponders(room, members, messageText(userMessage), history, bots);

  const initial = responders.map((bot) => ({ bot, route, depth: 0 }));
  const initialResults = await Promise.all(initial.map(async ({ bot, route: note }) => {
    const transcript = await listMessages(conversationId, 60);
    const reply = await runTurn({
      bot,
      conversationId,
      content: roomPrompt(room, bot, members, catchUp(transcript, bot, bots), note.by === "handoff", collaborationRecords),
      route: note,
    });
    if (reply && reply.status === "done") {
      const text = messageText(reply);
      const isChallenge = isChallengeContent(text);
      const mentioned = mentionsIn(text, members).find((b) => b.id !== bot.id);
      await recordCollaboration(room, bot.id, isChallenge ? "challenge" : "intermediate", text, mentioned?.id);
    }
    return { bot, reply };
  }));

  const queue: Array<{ bot: Bot; route: RouteNote; depth: number }> = [];
  const transcriptAfterParallel = await listMessages(conversationId, 60);
  for (const { bot, reply } of initialResults) {
    const latest = reply ?? transcriptAfterParallel.filter((message) => message.botId === bot.id && message.role === "bot").at(-1);
    if (!latest) continue;
    for (const next of mentionsIn(messageText(latest), members)) {
      if (next.id === bot.id || queue.some((item) => item.bot.id === next.id)) continue;
      queue.push({ bot: next, route: { by: "handoff" }, depth: 1 });
      await recordCollaboration(room, bot.id, "handoff", messageText(latest), next.id);
    }
  }
  const responderIds = new Set(initial.map(({ bot }) => bot.id));

  // Guaranteed explicit review step: select reviewer (designated lead, non-responder, or senior peer)
  let reviewer: Bot | undefined;
  if (members.length > 1) {
    reviewer = members.find((bot) => !responderIds.has(bot.id));
    if (!reviewer && room.leadId) {
      reviewer = members.find((bot) => bot.id === room.leadId);
    }
    if (!reviewer) {
      reviewer = members[0];
    }
  }

  if (reviewer && stopEpochOf(conversationId) === epoch) {
    const transcript = await listMessages(conversationId, 60);
    const summary = transcript
      .filter((message) => message.role === "bot" && message.status === "done" && message.botId !== reviewer!.id)
      .map((message) => `${authorName(message, bots)} (@${bots.get(message.botId ?? "")?.handle ?? "agent"}):\n${messageText(message)}`)
      .join("\n\n");

    if (summary.trim()) {
      const { reviewMessage, findings } = await executeReviewerAudit(
        room,
        reviewer,
        members,
        summary,
        conversationId,
      );

      if (reviewMessage && findings) {
        const targetBotId = findings.targetBotId || members.find((m) => m.id !== reviewer!.id)?.id;

        if (findings.verdict === "challenge") {
          const detail = findings.materialDefects.length
            ? findings.materialDefects.join("; ")
            : findings.evidenceAssessment;
          await recordCollaboration(
            room,
            reviewer.id,
            "challenge",
            `[Evidence Challenge] ${detail}`,
            targetBotId,
          );

          if (targetBotId && targetBotId !== reviewer.id) {
            const challenged = members.find((m) => m.id === targetBotId);
            if (challenged && !queue.some((q) => q.bot.id === challenged.id)) {
              queue.push({ bot: challenged, route: { by: "handoff" }, depth: 1 });
            }
          }
        } else {
          await recordCollaboration(
            room,
            reviewer.id,
            "verification",
            `[Evidence Verified] Claims audited: ${findings.claimsAudited.join(", ") || "All contributions verified"}. ${findings.evidenceAssessment}`,
            targetBotId,
          );
        }
      }
    }
  }
  while (queue.length && stopEpochOf(conversationId) === epoch) {
    const { bot, route: note, depth } = queue.shift()!;
    const transcript = await listMessages(conversationId, 60);
    const reply = await runTurn({
      bot,
      conversationId,
      content: roomPrompt(room, bot, members, catchUp(transcript, bot, bots), note.by === "handoff", collaborationRecords),
      route: note,
    });
    if (!reply || reply.status !== "done" || depth >= MAX_HANDOFF_DEPTH) continue;
    const text = messageText(reply);
    const isChallenge = isChallengeContent(text);
    const mentioned = mentionsIn(text, members).find((b) => b.id !== bot.id);
    await recordCollaboration(room, bot.id, isChallenge ? "challenge" : "intermediate", text, mentioned?.id);
    for (const next of mentionsIn(messageText(reply), members)) {
      if (next.id === bot.id || queue.some((q) => q.bot.id === next.id)) continue;
      queue.push({ bot: next, route: { by: "handoff" }, depth: depth + 1 });
      await recordCollaboration(room, bot.id, "handoff", messageText(reply), next.id);
    }
  }
}
