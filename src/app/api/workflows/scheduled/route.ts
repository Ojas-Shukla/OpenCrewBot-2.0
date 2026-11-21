import { body, handle } from "@/lib/server/http";
import { createScheduledWorkflow, scheduledWorkflows, workflowRuns } from "@/lib/server/workflows";

export async function GET() {
  return handle(async () => ({ schedules: await scheduledWorkflows(), runs: await workflowRuns() }));
}

export async function POST(request: Request) {
  return handle(async () => ({
    schedule: await createScheduledWorkflow(await body<{ name: string; workflowId: string; cron: string }>(request)),
  }));
}
