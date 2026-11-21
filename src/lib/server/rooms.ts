// Group rooms: decide who answers, give each bot the part of the room it
// hasn't seen, and let a bot hand off to a teammate by @mentioning them.
import { randomUUID } from "node:crypto";
import type { Bot, ChatMessage, Room, RouteNote } from "@/lib/shared/types";
import { listBots, listMessages, listCollaborationRecords, saveCollaborationRecord } from "./db";
import { pickResponders } from "./jev";
import { runTurn, stopEpochOf } from "./runtime";
import { readSharedMemory } from "./memory-files";

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
      await recordCollaboration(room, bot.id, "intermediate", messageText(reply));
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
  const reviewer = members.find((bot) => !responderIds.has(bot.id));
  if (reviewer && stopEpochOf(conversationId) === epoch) {
    const transcript = await listMessages(conversationId, 60);
    const summary = transcript.filter((message) => message.role === "bot" && message.status === "done")
      .map((message) => `${authorName(message, bots)}: ${messageText(message)}`).join("\n\n");
    const review = await runTurn({
      bot: reviewer,
      conversationId,
      content: [
        `Review the other agents' work in "${room.name}".`,
        "Check for unsupported claims, contradictions, missing perspectives and unaddressed user requirements.",
        "If you find a material issue, challenge it with a concise explanation. Otherwise state what you verified and any remaining uncertainty.",
        `Contributions:\n${summary}`,
      ].join("\n\n"),
      route: { by: "handoff" },
    });
    if (review && review.status === "done") await recordCollaboration(room, reviewer.id, "verification", messageText(review));
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
    await recordCollaboration(room, bot.id, "intermediate", messageText(reply));
    for (const next of mentionsIn(messageText(reply), members)) {
      if (next.id === bot.id || queue.some((q) => q.bot.id === next.id)) continue;
      queue.push({ bot: next, route: { by: "handoff" }, depth: depth + 1 });
      await recordCollaboration(room, bot.id, "handoff", messageText(reply), next.id);
    }
  }
}
