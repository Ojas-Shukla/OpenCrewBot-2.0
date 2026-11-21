export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: string;
}

export async function retryWithFallback<T>(
  candidates: string[],
  maxAttempts: number,
  run: (model: string, attempt: number) => Promise<RetryResult<T>>,
  shouldContinue: () => Promise<boolean> = async () => true,
): Promise<{ success: boolean; value?: T; error?: string; attempts: number }> {
  if (!candidates.length) throw new Error("At least one model candidate is required.");
  let error: string | undefined;
  let attempts = 0;
  while (attempts < maxAttempts && await shouldContinue()) {
    const attempt = attempts;
    attempts += 1;
    try {
      const result = await run(candidates[attempt % candidates.length], attempt + 1);
      if (result.success) return { ...result, attempts: attempt + 1 };
      error = result.error ?? "Attempt failed without an error message.";
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  return {
    success: false,
    error: error ?? "No model attempt was made because the execution was cancelled.",
    attempts,
  };
}

export function recoverInterruptedTask<T extends {
  status: string;
  attempts: number;
  maxAttempts: number;
  error?: string;
}>(task: T): T | null {
  if (task.status !== "running") return null;
  return {
    ...task,
    status: "pending",
    error: "Recovered after an interrupted server process.",
    attempts: task.attempts >= task.maxAttempts ? Math.max(0, task.maxAttempts - 1) : task.attempts,
  };
}

export function readyTasks<T extends { status: string; dependencies: string[] }>(
  tasks: T[],
  completedIds: Set<string>,
): T[] {
  return tasks.filter((task) => task.status === "pending" && task.dependencies.every((dependency) => completedIds.has(dependency)));
}

export function mayAutoApprove(
  mode: "ask" | "controlled" | "full",
  controlledTools: string[],
  toolName: string,
): boolean {
  return mode === "full" || (mode === "controlled" && controlledTools.includes(toolName));
}

export function isChallengeContent(text: string): boolean {
  return /\b(challenge|contradict|contradiction|disagree|dispute|flaw|incorrect|unsupported|inaccurate|objection|rebuttal|issue found|fallacy|counter-argument)\b/i.test(text);
}

const SKILL_KEYWORDS: Record<string, string[]> = {
  "Market Research": ["market", "industry", "customer", "trend", "consumer", "tam", "demographic", "landscape"],
  "Competitor Analysis": ["competitor", "pricing", "positioning", "alternative", "comparison", "benchmark", "vs", "rival"],
  "Financial Modelling": ["financial", "finance", "model", "forecast", "revenue", "cost", "cash flow", "projection", "dcf", "valuation", "margin"],
  "Presentation Creation": ["presentation", "slide", "slides", "deck", "pitch", "keynote", "speaker notes", "powerpoint"],
  "Email Drafting": ["email", "outreach", "newsletter", "subject line", "cold email", "follow-up", "inbox", "message draft"],
  "Code Review": ["code review", "pull request", "refactor", "bug", "vulnerability", "diff", "pr", "lint", "syntax", "defect", "repository"],
  "Data Analysis": ["data analysis", "dataset", "spreadsheet", "analytics", "csv", "metrics", "chart", "distribution", "statistics", "kpi"],
  "Lead Generation": ["lead", "leads", "prospect", "prospects", "outreach list", "qualification", "b2b", "icp", "pipeline"],
};

export function identifyRelevantSkills<T extends { name: string; category: string; description: string }>(
  text: string,
  skills: T[],
): T[] {
  if (!text) return [];
  const normalized = text.toLowerCase();
  const scored: Array<{ skill: T; score: number }> = [];

  for (const skill of skills) {
    let score = 0;
    if (normalized.includes(skill.name.toLowerCase())) {
      score += 10;
    }
    if (normalized.includes(skill.category.toLowerCase())) {
      score += 3;
    }
    const keywords = SKILL_KEYWORDS[skill.name] ?? [];
    for (const kw of keywords) {
      if (new RegExp(`\\b${kw}\\b`, "i").test(normalized)) {
        score += 2;
      }
    }
    const descWords = skill.description.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    for (const dw of descWords) {
      if (normalized.includes(dw)) {
        score += 1;
      }
    }
    if (score >= 2) {
      scored.push({ skill, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.skill);
}
