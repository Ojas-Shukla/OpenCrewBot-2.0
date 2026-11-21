import { randomUUID } from "node:crypto";
import type { ApprovalRequest } from "@/lib/shared/types";
import { getApprovalRequest, listApprovalRequests, saveApprovalRequest, writeAuditEvent } from "./db";
import { InputError } from "./errors";

export async function createApprovalRequest(input: Omit<ApprovalRequest, "id" | "status" | "createdAt">): Promise<ApprovalRequest> {
  if (!input.botId || !input.toolName?.trim() || !input.action?.trim() || !input.preview?.trim()) {
    throw new InputError("An approval requires a bot, tool, action and preview.");
  }
  const request: ApprovalRequest = {
    ...input,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await saveApprovalRequest(request);
  await writeAuditEvent({ id: randomUUID(), type: "approval.requested", createdAt: request.createdAt, data: request });
  return request;
}

export async function resolveApprovalRequest(id: string, resolution: "allow_once" | "reject"): Promise<ApprovalRequest> {
  const request = await getApprovalRequest(id);
  if (!request) throw new InputError("Approval request not found.");
  if (request.status !== "pending") throw new InputError("This approval request has already been resolved.");
  if (request.conversationId && request.botId && request.toolCallId) {
    const runtime = await import("./runtime");
    await runtime.respondToApproval(request.conversationId, request.botId, request.toolCallId, resolution === "allow_once");
    const current = await getApprovalRequest(id);
    if (current && current.status !== "pending") return current;
  }
  const resolvedAt = new Date().toISOString();
  const resolved: ApprovalRequest = {
    ...request,
    status: resolution === "allow_once" ? "approved" : "rejected",
    resolvedAt,
    resolution,
  };
  await saveApprovalRequest(resolved);
  await writeAuditEvent({ id: randomUUID(), type: "approval.resolved", createdAt: resolvedAt, data: resolved });
  return resolved;
}

export function approvals() {
  return listApprovalRequests();
}
