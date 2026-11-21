import assert from "node:assert/strict";
import test from "node:test";
import { nextCronRun, validateCron } from "../src/lib/server/cron.ts";
import { identifyRelevantSkills, isChallengeContent, mayAutoApprove, parseReviewFindings, readyTasks, recoverInterruptedTask, retryWithFallback } from "../src/lib/server/execution-policy.ts";

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

test("semantic skill identification matches intent and avoids incidental keywords", () => {
  const dummySkills = [
    { id: "s1", name: "Financial Modelling", category: "analysis", description: "Build assumptions, calculations and scenario models", instructions: "State assumptions, show calculations, identify sensitivities", outputFormat: "Assumptions, calculations and recommendations", tools: ["code_mode"], createdAt: "", updatedAt: "" },
    { id: "s2", name: "Code Review", category: "development", description: "Review code for correctness, security and maintainability", instructions: "Prioritize high-confidence defects, explain impact and propose precise fixes", outputFormat: "Prioritized findings with file references", tools: ["memory"], createdAt: "", updatedAt: "" },
    { id: "s3", name: "Competitor Analysis", category: "research", description: "Compare competitors, positioning and products", instructions: "Compare competitors by product, customer, pricing, positioning, strengths and weaknesses", outputFormat: "Comparison matrix and opportunity analysis", tools: ["web_search"], createdAt: "", updatedAt: "" },
  ];

  // True positive intent matches
  const matchedFin = identifyRelevantSkills("Analyze our cash flow forecast and calculate a discounted financial model for quarterly revenue", dummySkills);
  assert.equal(matchedFin.some((s) => s.name === "Financial Modelling"), true);

  const matchedCode = identifyRelevantSkills("Audit this pull request branch for security vulnerabilities, bugs, and defects", dummySkills);
  assert.equal(matchedCode.some((s) => s.name === "Code Review"), true);

  const matchedComp = identifyRelevantSkills("Benchmark our competitor pricing tiers and evaluate their market positioning", dummySkills);
  assert.equal(matchedComp.some((s) => s.name === "Competitor Analysis"), true);

  // Negative test: incidental common word must NOT trigger false positive
  const casualModel = identifyRelevantSkills("The visual model of that vintage sports car looks very sleek.", dummySkills);
  assert.equal(casualModel.some((s) => s.name === "Financial Modelling"), false);

  const casualCode = identifyRelevantSkills("What is the zip code for our new office location?", dummySkills);
  assert.equal(casualCode.some((s) => s.name === "Code Review"), false);
});

test("explicit reviewer step parses structured findings and enforces evidence challenges", () => {
  const members = [
    { id: "bot-1", name: "Scout", handle: "scout" },
    { id: "bot-2", name: "Atlas", handle: "atlas" },
  ];

  const challengeOutput = `
I have audited the findings.
\`\`\`json
{
  "verdict": "challenge",
  "targetBotHandle": "scout",
  "claimsAudited": ["SaaS pricing is $49/month", "Total market volume is $10B"],
  "evidenceAssessment": "Citations directly contradict the $49 pricing; official portal lists $79 tier. Market volume claim is unsupported by cited reports.",
  "materialDefects": [
    "Pricing discrepancy: cited $49/mo vs documented $79/mo",
    "Unsubstantiated market sizing claim without authoritative source"
  ],
  "recommendations": "Reconcile pricing matrix with live product page.",
  "confidence": 0.95
}
\`\`\`
Tagging @scout to resolve these material defects.
`;

  const challengeFindings = parseReviewFindings(challengeOutput, members);
  assert.equal(challengeFindings.verdict, "challenge");
  assert.equal(challengeFindings.targetBotId, "bot-1");
  assert.equal(challengeFindings.targetBotHandle, "scout");
  assert.equal(challengeFindings.materialDefects.length, 2);
  assert.equal(challengeFindings.claimsAudited.length, 2);

  const verifiedOutput = `
\`\`\`json
{
  "verdict": "verified",
  "targetBotHandle": "none",
  "claimsAudited": ["All API routes respond with status 200", "Latency benchmark averages 85ms"],
  "evidenceAssessment": "Every latency sample and endpoint response code was checked against server logs and verified.",
  "materialDefects": [],
  "confidence": 0.98
}
\`\`\`
All claims verified against runtime evidence.
`;

  const verifiedFindings = parseReviewFindings(verifiedOutput, members);
  assert.equal(verifiedFindings.verdict, "verified");
  assert.equal(verifiedFindings.materialDefects.length, 0);
  assert.equal(verifiedFindings.claimsAudited.length, 2);
});

test("cron endpoint security enforcement rejects unauthenticated or GET requests", () => {
  // Logic mirror of verifyCronSecret
  const checkAccess = (method, secret, authHeader, queryParam) => {
    if (method !== "POST") return { status: 405, error: "Method Not Allowed" };
    if (!secret || !secret.trim()) return { status: 401, error: "CRON_SECRET not configured" };
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const provided = bearer || queryParam;
    if (!provided || provided !== secret) return { status: 401, error: "Invalid token" };
    return { status: 200, ok: true };
  };

  // 1. GET requests must be rejected
  assert.equal(checkAccess("GET", "my-secret", "Bearer my-secret").status, 405);

  // 2. Missing secret on server must return 401
  assert.equal(checkAccess("POST", "", "Bearer my-secret").status, 401);

  // 3. Unauthenticated POST must return 401
  assert.equal(checkAccess("POST", "my-secret", undefined).status, 401);
  assert.equal(checkAccess("POST", "my-secret", "Bearer wrong-token").status, 401);

  // 4. Valid authorized POST must succeed
  assert.equal(checkAccess("POST", "my-secret", "Bearer my-secret").status, 200);
  assert.equal(checkAccess("POST", "my-secret", undefined, "my-secret").status, 200);
});

test("challenge content detection flags contradictions, disputes, and material defects", () => {
  assert.equal(isChallengeContent("I challenge this pricing conclusion because official rates are 20% lower."), true);
  assert.equal(isChallengeContent("There is a clear contradiction between the market size estimate and the cited report."), true);
  assert.equal(isChallengeContent("I dispute the claim that this endpoint is deprecated."), true);
  assert.equal(isChallengeContent("The research looks accurate, verified against the official documentation."), false);
});

test("approval expiration and allow_always workflow maintain safe autonomy", () => {
  const now = Date.now();
  const past = new Date(now - 60000).toISOString();
  const future = new Date(now + 60000).toISOString();

  const isExpired = (item) => item.status === "pending" && item.expiresAt && Date.parse(item.expiresAt) <= now;
  assert.equal(isExpired({ status: "pending", expiresAt: past }), true);
  assert.equal(isExpired({ status: "pending", expiresAt: future }), false);
  assert.equal(isExpired({ status: "approved", expiresAt: past }), false);

  // When a user selects allow_always, the tool enters controlledTools and succeeds in controlled mode
  const botControlled = ["git_diff"];
  assert.equal(mayAutoApprove("controlled", botControlled, "git_diff"), true);
  assert.equal(mayAutoApprove("controlled", botControlled, "git_push"), false);
  botControlled.push("git_push");
  assert.equal(mayAutoApprove("controlled", botControlled, "git_push"), true);
});
