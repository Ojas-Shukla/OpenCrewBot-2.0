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

export interface StructuredReviewFindings {
  verdict: "challenge" | "verified";
  targetBotId?: string;
  targetBotHandle?: string;
  claimsAudited: string[];
  evidenceAssessment: string;
  materialDefects: string[];
  recommendations?: string;
  confidence: number;
}

export function parseReviewFindings(
  text: string,
  members: Array<{ id: string; name: string; handle: string }>,
): StructuredReviewFindings {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i) || text.match(/(\{[\s\S]*"verdict"[\s\S]*\})/i);
  let parsed: Partial<StructuredReviewFindings> | null = null;
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]) as Partial<StructuredReviewFindings>;
    } catch {
      // try fallback
    }
  }

  const findBot = (ref?: string) => {
    if (!ref || ref === "none") return undefined;
    const clean = ref.replace(/^@/, "").toLowerCase().trim();
    return members.find((m) => m.id === ref || m.handle.toLowerCase() === clean || m.name.toLowerCase() === clean);
  };

  if (parsed && (parsed.verdict === "challenge" || parsed.verdict === "verified")) {
    const targetBot = findBot(parsed.targetBotHandle) || findBot(parsed.targetBotId);
    return {
      verdict: parsed.verdict,
      targetBotId: targetBot?.id,
      targetBotHandle: targetBot?.handle || parsed.targetBotHandle,
      claimsAudited: Array.isArray(parsed.claimsAudited) ? parsed.claimsAudited.map(String) : [],
      evidenceAssessment: String(parsed.evidenceAssessment || "").trim(),
      materialDefects: Array.isArray(parsed.materialDefects) ? parsed.materialDefects.map(String) : [],
      recommendations: parsed.recommendations ? String(parsed.recommendations).trim() : undefined,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.9,
    };
  }

  const verdictMatch = text.match(/\bverdict\s*:\s*(challenge|verified)\b/i);
  const isExplicitChallenge = verdictMatch
    ? verdictMatch[1].toLowerCase() === "challenge"
    : Boolean(text.match(/\[CHALLENGE\]|\b(?:challenge|contradiction|dispute|discrepancy|material defect|refute|unsupported claim)\b/i));

  const defects: string[] = [];
  const defectMatch = text.match(/(?:material defects|defects|issues|contradictions)\s*:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/i);
  if (defectMatch) {
    defects.push(...defectMatch[1].split(/\n[-*•]\s*/).map((s) => s.trim()).filter(Boolean));
  }

  const claims: string[] = [];
  const claimsMatch = text.match(/(?:claims audited|audited claims|claims)\s*:\s*([\s\S]*?)(?:\n\n|\n[A-Z]|$)/i);
  if (claimsMatch) {
    claims.push(...claimsMatch[1].split(/\n[-*•]\s*/).map((s) => s.trim()).filter(Boolean));
  }

  const mentionedBot = members.find((m) => text.toLowerCase().includes(`@${m.handle.toLowerCase()}`) || text.toLowerCase().includes(m.name.toLowerCase()));

  return {
    verdict: isExplicitChallenge ? "challenge" : "verified",
    targetBotId: mentionedBot?.id,
    targetBotHandle: mentionedBot?.handle,
    claimsAudited: claims.length ? claims : ["Agent contributions and evidence claims"],
    evidenceAssessment: text.slice(0, 300).trim(),
    materialDefects: defects,
    confidence: isExplicitChallenge ? 0.85 : 0.95,
  };
}

export function isChallengeContent(text: string): boolean {
  return parseReviewFindings(text, []).verdict === "challenge";
}

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing",
  "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
  "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into",
  "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our",
  "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's",
  "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs",
  "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
  "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
  "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't",
  "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
  "yourselves", "please", "like", "want", "need", "today", "show", "help", "also", "just"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function stem(word: string): string {
  return word
    .toLowerCase()
    .replace(/(ing|tion|tions|ment|ments|ies|ied|es|s|ed|ly|al|ic|ive|able|ible|e)$/, "")
    .replace(/(.)\1$/, "$1")
    .trim();
}

export function identifyRelevantSkills<T extends {
  name: string;
  category: string;
  description: string;
  instructions?: string;
  outputFormat?: string;
}>(
  text: string,
  skills: T[],
): T[] {
  if (!text || !skills.length) return [];
  const normalized = text.toLowerCase();
  const inputTokens = tokenize(text);
  if (!inputTokens.length) return [];

  const inputStems = new Set(inputTokens.map(stem));
  const scored: Array<{ skill: T; score: number }> = [];

  for (const skill of skills) {
    let score = 0;
    const skillNameLower = skill.name.toLowerCase();

    // Direct invocation by skill name has highest confidence
    if (normalized.includes(skillNameLower)) {
      score += 15;
    }

    // Dynamic semantic scoring across skill definition without fixed keyword maps
    const skillCorpus = [
      skill.name,
      skill.category,
      skill.description,
      skill.instructions ?? "",
      skill.outputFormat ?? "",
    ].join(" ");

    const skillTokens = tokenize(skillCorpus);
    const skillStems = new Map<string, number>();
    for (const token of skillTokens) {
      const s = stem(token);
      if (s.length > 2) skillStems.set(s, (skillStems.get(s) ?? 0) + 1);
    }

    let distinctConceptMatches = 0;
    for (const userStem of inputStems) {
      if (skillStems.has(userStem)) {
        distinctConceptMatches++;
        score += skillNameLower.includes(userStem) ? 4 : 2.5;
      }
    }

    // Intent gate: casual isolated words (e.g. "model" or "market") do NOT activate a skill
    if (score < 10 && distinctConceptMatches < 2) {
      continue;
    }

    if (normalized.includes(skill.category.toLowerCase())) {
      score += 3;
    }

    const actionSynonyms: Record<string, string[]> = {
      review: ["audit", "inspect", "check", "examine"],
      audit: ["review", "inspect", "check"],
      analyze: ["evaluate", "assess", "benchmark", "diagnose"],
      create: ["build", "generate", "draft", "write"],
    };

    const actionVerbs = ["analyze", "analyse", "audit", "benchmark", "build", "calculate", "compare", "create", "draft", "evaluate", "forecast", "generate", "inspect", "model", "prospect", "research", "review", "simulate"];
    for (const v of actionVerbs) {
      if (normalized.includes(v)) {
        if (skillCorpus.toLowerCase().includes(v)) {
          score += 2;
        } else {
          const synonyms = actionSynonyms[v] ?? [];
          if (synonyms.some((syn) => skillCorpus.toLowerCase().includes(syn))) {
            score += 1.5;
          }
        }
      }
    }

    if (score >= 5) {
      scored.push({ skill, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.skill);
}
