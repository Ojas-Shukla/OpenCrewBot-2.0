import { body, handle } from "@/lib/server/http";
import { createScheduledWorkflow, scheduledWorkflows } from "@/lib/server/workflows";

export async function GET() {
  return handle(async () => ({ schedules: await scheduledWorkflows() }));
}

export async function POST(request: Request) {
  return handle(async () => ({
    schedule: await createScheduledWorkflow(await body<{ name: string; workflowId: string; cron: string }>(request)),
  }));
}
