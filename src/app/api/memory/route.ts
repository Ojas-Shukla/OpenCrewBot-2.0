import { listMemoryRecords } from "@/lib/server/db";
import { handle } from "@/lib/server/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") || undefined;
  const ownerId = url.searchParams.get("ownerId") || undefined;
  return handle(async () => ({ memory: await listMemoryRecords(scope, ownerId) }));
}
