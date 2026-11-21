import { listAuditEvents } from "@/lib/server/db";
import { handle } from "@/lib/server/http";

export async function GET() {
  return handle(async () => ({ events: await listAuditEvents() }));
}
