import { conversationParam, handle } from "@/lib/server/http";
import { getExecution } from "@/lib/server/execution";

export async function GET(_request: Request, ctx: RouteContext<"/api/executions/[id]">) {
  const id = conversationParam((await ctx.params).id);
  return handle(async () => {
    const execution = await getExecution(id);
    return execution ? { execution } : Response.json({ error: "Execution not found." }, { status: 404 });
  });
}
