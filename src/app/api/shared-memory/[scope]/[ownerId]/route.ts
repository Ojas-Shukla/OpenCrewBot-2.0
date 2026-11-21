import { body, handle } from "@/lib/server/http";
import { readSharedMemory, writeSharedMemory } from "@/lib/server/memory-files";
import { saveMemoryRecord } from "@/lib/server/db";
import { randomUUID } from "node:crypto";
import type { MemoryScope } from "@/lib/shared/types";
import { InputError } from "@/lib/server/errors";

const allowed = new Set(["room", "project", "user"]);

export async function GET(_request: Request, ctx: { params: Promise<{ scope: string; ownerId: string }> }) {
  const { scope, ownerId } = await ctx.params;
  return handle(async () => {
    if (!allowed.has(scope)) throw new InputError("Shared memory scope must be room, project or user.");
    return { content: readSharedMemory(scope as "room" | "project" | "user", ownerId), path: ownerId };
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ scope: string; ownerId: string }> }) {
  const { scope, ownerId } = await ctx.params;
  return handle(async () => {
    if (!allowed.has(scope)) throw new InputError("Shared memory scope must be room, project or user.");
    const { content, reason } = await body<{ content: string; reason?: string }>(request);
    if (typeof content !== "string") throw new InputError("Expected { content }.");
    const saved = writeSharedMemory(scope as "room" | "project" | "user", ownerId, content);
    const now = new Date().toISOString();
    await saveMemoryRecord({
      id: randomUUID(),
      scope: scope as MemoryScope,
      ownerId,
      content: saved,
      source: "shared-memory",
      reason: reason?.trim() || "User updated shared memory.",
      createdAt: now,
      updatedAt: now,
    });
    return { content: saved };
  });
}
