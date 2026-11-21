import { randomUUID } from "node:crypto";
import type { ApprovalRequest } from "@/lib/shared/types";
import { getApprovalRequest, getBot, listApprovalRequests, saveApprovalRequest, saveBot, writeAuditEvent } from "./db";
import { InputError } from "./errors";

export const DEFAULT_APPROVAL_EXPIRY_MS = 15 * 60 * 1000;

export async function createApprovalRequest(input: Omit<ApprovalRequest, "id" | "status" | "createdAt">): Promise<ApprovalRequest> {
  if (!input.botId || !input.toolName?.trim() || !input.action?.trim() || !input.preview?.trim()) {
    throw new InputError("An approval requires a bot, tool, action and preview.");
  }
  const createdAt = new Date().toISOString();
  const timeoutMs = Number(process.env.APPROVAL_TIMEOUT_MS) || DEFAULT_APPROVAL_EXPIRY_MS;
  const expiresAt = input.expiresAt ?? new Date(Date.now() + timeoutMs).toISOString();
  const request: ApprovalRequest = {
    ...input,
    id: randomUUID(),
    status: "pending",
    createdAt,
    expiresAt,
  };
  await saveApprovalRequest(request);
  await writeAuditEvent({ id: randomUUID(), type: "approval.requested", createdAt: request.createdAt, data: request });
  return request;
}

export async function sweepExpiredApprovals(): Promise<ApprovalRequest[]> {
  const all = await listApprovalRequests();
  const now = Date.now();
  const expired: ApprovalRequest[] = [];
  for (const item of all) {
    if (item.status === "pending" && item.expiresAt && Date.parse(item.expiresAt) <= now) {
      const resolvedAt = new Date().toISOString();
      const updated: ApprovalRequest = {
        ...item,
        status: "expired",
        resolvedAt,
      };
      await saveApprovalRequest(updated);
      await writeAuditEvent({ id: randomUUID(), type: "approval.expired", createdAt: resolvedAt, data: updated });
      if (item.conversationId && item.botId && item.toolCallId) {
        try {
          const runtime = await import("./runtime");
          await runtime.expireApproval(item.conversationId, item.botId, item.toolCallId);
        } catch {
          // session might not be active
        }
      }
      expired.push(updated);
    }
  }
  return expired;
}

export async function resolveApprovalRequest(
  id: string,
  resolution: "allow_once" | "allow_always" | "reject",
): Promise<ApprovalRequest> {
  const request = await getApprovalRequest(id);
  if (!request) throw new InputError("Approval request not found.");
  if (request.status !== "pending") throw new InputError("This approval request has already been resolved.");

  if (request.conversationId && request.botId && request.toolCallId) {
    const runtime = await import("./runtime");
    await runtime.respondToApproval(
      request.conversationId,
      request.botId,
      request.toolCallId,
      resolution !== "reject",
      resolution === "allow_always",
    );
    const current = await getApprovalRequest(id);
    if (current && current.status !== "pending") return current;
  }

  if (resolution === "allow_always") {
    const bot = await getBot(request.botId);
    if (bot) {
      const controlled = new Set(bot.controlledTools ?? []);
      controlled.add(request.toolName);
      bot.controlledTools = Array.from(controlled);
      if (bot.approval === "ask") {
        bot.approval = "controlled";
      }
      await saveBot(bot);
      const runtime = await import("./runtime");
      await runtime.resetBot(bot.id);
    }
  }

  const resolvedAt = new Date().toISOString();
  const resolved: ApprovalRequest = {
    ...request,
    status: resolution === "reject" ? "rejected" : "approved",
    resolvedAt,
    resolution,
  };
  await saveApprovalRequest(resolved);
  await writeAuditEvent({ id: randomUUID(), type: "approval.resolved", createdAt: resolvedAt, data: resolved });
  return resolved;
}

export async function approvals() {
  await sweepExpiredApprovals();
  return listApprovalRequests();
}
