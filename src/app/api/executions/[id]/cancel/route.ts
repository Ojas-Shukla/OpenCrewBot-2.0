import { cancelExecution } from "@/lib/server/execution";
import { handle } from "@/lib/server/http";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => ({ execution: await cancelExecution(id) }));
}
