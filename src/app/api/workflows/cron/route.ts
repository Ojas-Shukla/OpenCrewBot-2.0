import { handle } from "@/lib/server/http";
import { tickScheduledWorkflows } from "@/lib/server/workflows";

function verifySecret(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return;
  const url = new URL(request.url);
  if (url.searchParams.get("secret") === secret) return;
  throw new Error("Unauthorized cron trigger.");
}

export async function GET(request: Request) {
  return handle(async () => {
    verifySecret(request);
    const result = await tickScheduledWorkflows();
    return { ok: true, timestamp: new Date().toISOString(), ...result };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    verifySecret(request);
    const result = await tickScheduledWorkflows();
    return { ok: true, timestamp: new Date().toISOString(), ...result };
  });
}
