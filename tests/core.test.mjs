import assert from "node:assert/strict";
import test from "node:test";
import { nextCronRun, validateCron } from "../src/lib/server/cron.ts";
import { mayAutoApprove, readyTasks, recoverInterruptedTask, retryWithFallback } from "../src/lib/server/execution-policy.ts";

test("cron parser computes the next UTC run and rejects invalid expressions", () => {
  const from = new Date("2026-11-21T17:13:30.000Z");
  assert.equal(nextCronRun("*/15 * * * *", from).toISOString(), "2026-11-21T17:15:00.000Z");
  assert.equal(nextCronRun("30 9 * * 1-5", from).toISOString(), "2026-11-23T09:30:00.000Z");
  assert.throws(() => validateCron("61 * * * *"), /minute value/);
  assert.throws(() => validateCron("not a cron"), /five fields/);
});

test("retry uses fallback candidates and returns on the first successful attempt", async () => {
  const attempted = [];
  const result = await retryWithFallback(["primary", "fallback"], 3, async (model) => {
    attempted.push(model);
    return model === "fallback"
      ? { success: true, value: "recovered" }
      : { success: false, error: "provider unavailable" };
  });
  assert.deepEqual(attempted, ["primary", "fallback"]);
  assert.deepEqual(result, { success: true, value: "recovered", attempts: 2 });
});

test("retry does not start fallback attempts after cancellation", async () => {
  const attempted = [];
  let shouldContinue = true;
  const result = await retryWithFallback(["primary", "fallback"], 3, async (model) => {
    attempted.push(model);
    shouldContinue = false;
    return { success: false, error: "cancelled" };
  }, async () => shouldContinue);
  assert.deepEqual(attempted, ["primary"]);
  assert.equal(result.attempts, 1);
});

test("interrupted tasks are reopened with a bounded retry count", () => {
  const recovered = recoverInterruptedTask({ status: "running", attempts: 3, maxAttempts: 3 });
  assert.deepEqual(recovered, {
    status: "pending",
    attempts: 2,
    maxAttempts: 3,
    error: "Recovered after an interrupted server process.",
  });
  assert.equal(recoverInterruptedTask({ status: "completed", attempts: 1, maxAttempts: 3 }), null);
});

test("dependency-ready tasks can run in parallel", () => {
  const tasks = [
    { id: "a", status: "pending", dependencies: [] },
    { id: "b", status: "pending", dependencies: [] },
    { id: "c", status: "pending", dependencies: ["a"] },
  ];
  assert.deepEqual(readyTasks(tasks, new Set()), [tasks[0], tasks[1]]);
});

test("controlled access auto-approves only explicitly configured tools", () => {
  assert.equal(mayAutoApprove("controlled", ["repo_read"], "repo_read"), true);
  assert.equal(mayAutoApprove("controlled", ["repo_read"], "repo_write"), false);
  assert.equal(mayAutoApprove("ask", ["repo_write"], "repo_write"), false);
  assert.equal(mayAutoApprove("full", [], "repo_write"), true);
});
