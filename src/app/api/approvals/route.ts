import { approvals, createApprovalRequest } from "@/lib/server/approvals";
import { body, handle } from "@/lib/server/http";
import type { ApprovalRequest } from "@/lib/shared/types";

export async function GET() {
  return handle(async () => ({ approvals: await approvals() }));
}

export async function POST(request: Request) {
  return handle(async () => ({
    approval: await createApprovalRequest(await body<Omit<ApprovalRequest, "id" | "status" | "createdAt">>(request)),
  }));
}
