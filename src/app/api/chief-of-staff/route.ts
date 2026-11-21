import { chiefOfStaffConfiguration, planAndExecute, setChiefOfStaffBot } from "@/lib/server/chief-of-staff";
import { body, handle } from "@/lib/server/http";

export async function POST(request: Request) {
  return handle(async () => {
    const input = await body<{ name?: string; instruction: string; execute?: boolean; plannerBotId?: string }>(request);
    return planAndExecute(input);
  });
}

export async function GET() {
  return handle(() => chiefOfStaffConfiguration());
}

export async function PUT(request: Request) {
  return handle(async () => {
    const { plannerBotId } = await body<{ plannerBotId: string }>(request);
    await setChiefOfStaffBot(plannerBotId);
    return chiefOfStaffConfiguration();
  });
}
