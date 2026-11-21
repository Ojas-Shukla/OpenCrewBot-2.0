import { planAndExecute } from "@/lib/server/chief-of-staff";
import { body, handle } from "@/lib/server/http";

export async function POST(request: Request) {
  return handle(async () => {
    const input = await body<{ name?: string; instruction: string; execute?: boolean }>(request);
    return planAndExecute(input);
  });
}
