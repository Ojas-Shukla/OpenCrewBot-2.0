import { listSkills } from "@/lib/server/db";
import { handle } from "@/lib/server/http";
import { seedSkills } from "@/lib/server/skills";

export async function GET() {
  return handle(async () => ({ skills: await seedSkills(), count: (await listSkills()).length }));
}
