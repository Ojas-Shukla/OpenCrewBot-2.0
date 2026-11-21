const baseUrl = process.env.OPENCREWBOT_TEST_URL || "http://127.0.0.1:3000";

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${path} returned ${response.status}`);
  return body;
}

function requireCount(name, actual, minimum) {
  if (actual < minimum) throw new Error(`${name}: expected at least ${minimum}, received ${actual}`);
  console.log(`PASS ${name}: ${actual}`);
}

const bootstrap = await request("/api/bootstrap");
requireCount("configurable agents", bootstrap.bots.length, 8);
requireCount("collaboration rooms", bootstrap.rooms.length, 4);

const skills = await request("/api/skills");
requireCount("reusable skills", skills.skills.length, 8);

const plan = await request("/api/chief-of-staff", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    instruction: "Create a research-backed business plan, identify dependencies, and produce one consolidated deliverable.",
    execute: false,
  }),
});
requireCount("Chief of Staff tasks", plan.tasks.length, 3);

console.log(`PASS mock mode: ${String(bootstrap.status.mock)}`);
