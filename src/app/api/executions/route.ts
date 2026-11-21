import { body, handle } from "@/lib/server/http";
import { createExecution, executionHistory } from "@/lib/server/execution";
import type { ExecutionTaskInput } from "@/lib/shared/types";

export async function GET() {
  return handle(async () => ({ executions: await executionHistory() }));
}

export async function POST(request: Request) {
  return handle(async () => ({ execution: await createExecution(await body<{ name: string; instruction: string; tasks: ExecutionTaskInput[] }>(request)) }));
}
