import { body, handle } from "@/lib/server/http";
import { setScheduledWorkflowStatus } from "@/lib/server/workflows";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => ({
    schedule: await setScheduledWorkflowStatus(id, (await body<{ status: "active" | "paused" }>(request)).status),
  }));
}
