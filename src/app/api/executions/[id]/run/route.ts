import { conversationParam, handle } from "@/lib/server/http";
import { executeExecution, getExecution } from "@/lib/server/execution";

export async function POST(_request: Request, ctx: RouteContext<"/api/executions/[id]/run">) {
  const id = conversationParam((await ctx.params).id);
  return handle(async () => {
    const execution = await getExecution(id);
    if (!execution) return Response.json({ error: "Execution not found." }, { status: 404 });
    void executeExecution(id).catch((error) => console.error("[execution]", error));
    return { ok: true, runId: id, status: execution.run.status === "running" ? "running" : "queued" };
  });
}
