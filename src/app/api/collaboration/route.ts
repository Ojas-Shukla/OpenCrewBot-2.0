import { randomUUID } from "node:crypto";
import { body, handle } from "@/lib/server/http";
import { listCollaborationRecords, saveCollaborationRecord } from "@/lib/server/db";
import type { CollaborationRecord } from "@/lib/shared/types";
import { InputError } from "@/lib/server/errors";

export async function GET(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId") || undefined;
  return handle(async () => ({ records: await listCollaborationRecords(roomId) }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = await body<Omit<CollaborationRecord, "id" | "createdAt" | "status">>(request);
    if (!input.roomId || !input.fromBotId || !input.type || !input.content?.trim()) throw new InputError("A collaboration record needs room, source bot, type and content.");
    const record: CollaborationRecord = {
      ...input,
      id: randomUUID(),
      status: "open",
      createdAt: new Date().toISOString(),
    };
    await saveCollaborationRecord(record);
    return { record };
  });
}
