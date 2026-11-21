import { body, handle } from "@/lib/server/http";
import type { ExecutionTaskInput } from "@/lib/shared/types";
import { createWorkflowTemplate, workflows } from "@/lib/server/workflows";

export async function GET() {
  return handle(async () => ({ workflows: await workflows() }));
}

export async function POST(request: Request) {
  return handle(async () => ({
    workflow: await createWorkflowTemplate(await body<{ name: string; description: string; instruction: string; taskTemplates: ExecutionTaskInput[] }>(request)),
  }));
}
