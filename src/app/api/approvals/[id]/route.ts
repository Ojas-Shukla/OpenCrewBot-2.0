import { resolveApprovalRequest } from "@/lib/server/approvals";
import { body, handle } from "@/lib/server/http";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => ({
    approval: await resolveApprovalRequest(id, (await body<{ resolution: "allow_once" | "allow_always" | "reject" }>(request)).resolution),
  }));
}
