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
