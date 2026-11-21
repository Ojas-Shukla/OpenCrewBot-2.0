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

const smokeApproval = await request("/api/approvals", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    botId: bootstrap.bots[0].id,
    toolName: "external_action",
    action: "Smoke test external action",
    preview: "This action must not execute.",
  }),
});
const rejected = await request(`/api/approvals/${smokeApproval.approval.id}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ resolution: "reject" }),
});
if (rejected.approval.status !== "rejected") throw new Error("Approval rejection did not persist.");
console.log("PASS approval rejection persisted");

await request("/api/shared-memory/project/smoke-test", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "# Smoke test memory\n- Persistence verified", reason: "Automated smoke test" }),
});
const remembered = await request("/api/shared-memory/project/smoke-test");
if (!remembered.content.includes("Persistence verified")) throw new Error("Shared memory did not persist.");
console.log("PASS shared memory persistence");

const cancelledPlan = await request("/api/executions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Cancellation smoke test",
    instruction: "Verify cancellation persists.",
    tasks: [{
      key: "cancel-me",
      title: "Cancellation probe",
      description: "This task should be cancelled.",
      assignedBotId: bootstrap.bots[0].id,
    }],
  }),
});
const cancelled = await request(`/api/executions/${cancelledPlan.execution.id}/cancel`, { method: "POST" });
if (cancelled.execution.status !== "cancelled") throw new Error("Execution cancellation did not persist.");
console.log("PASS execution cancellation");

const workflow = await request("/api/workflows", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: `Smoke workflow ${Date.now()}`,
    description: "Scheduled workflow persistence probe.",
    instruction: "Produce a short status summary.",
    taskTemplates: [{
      key: "summary",
      title: "Write status summary",
      description: "Return a one-sentence status summary.",
      assignedBotId: bootstrap.bots[0].id,
    }],
  }),
});
const schedule = await request("/api/workflows/scheduled", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: `Smoke schedule ${Date.now()}`,
    workflowId: workflow.workflow.id,
    cron: "0 0 1 1 *",
  }),
});
const scheduledRun = await request(`/api/workflows/scheduled/${schedule.schedule.id}`, { method: "POST" });
let workflowExecution;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  workflowExecution = await request(`/api/executions/${scheduledRun.execution.id}`);
  if (!["running", "pending", "planned"].includes(workflowExecution.execution.run.status)) break;
}
if (workflowExecution.execution.run.status !== "completed") {
  throw new Error(`Scheduled workflow execution did not complete: ${workflowExecution.execution.run.status}`);
}
const scheduleHistory = await request("/api/workflows/scheduled");
const persistedSchedule = scheduleHistory.schedules.find((item) => item.id === schedule.schedule.id);
if (persistedSchedule?.lastRunStatus !== "completed") throw new Error("Scheduled workflow completion status did not persist.");
console.log("PASS scheduled workflow run and completion status");
