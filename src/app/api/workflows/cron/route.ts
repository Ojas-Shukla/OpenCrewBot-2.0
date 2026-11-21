import { handle } from "@/lib/server/http";
import { tickScheduledWorkflows } from "@/lib/server/workflows";

function verifyCronSecret(request: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { error: "Unauthorized: CRON_SECRET is not configured on this server. Configure CRON_SECRET to enable external triggers." },
      { status: 401 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const url = new URL(request.url);
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const querySecret = url.searchParams.get("secret")?.trim() || null;
  const provided = bearerToken || querySecret;

  if (!provided || provided !== secret) {
    return Response.json(
      { error: "Unauthorized: Invalid or missing authorization token for cron trigger." },
      { status: 401 },
    );
  }

  return null;
}

export async function GET() {
  return Response.json(
    { error: "Method Not Allowed: Scheduled workflows can only be triggered via POST with authorization." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  return handle(async () => {
    const result = await tickScheduledWorkflows();
    return { ok: true, timestamp: new Date().toISOString(), ...result };
  });
}
