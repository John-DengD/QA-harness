export interface ApiPollResult<T> {
  attempts: number;
  elapsedMs: number;
  value: T;
}

interface ApiPollEvidence<T> {
  attempts: number;
  elapsedMs: number;
  error?: string;
  value?: T;
}

interface ApiPollOptions<T> {
  describeFailure?: (value: T) => string | null;
  isComplete: (value: T) => boolean;
  onEvidence?: (evidence: ApiPollEvidence<T>) => Promise<void>;
  read: () => Promise<T>;
  timeoutMs: number;
}

export const pollApi = async <T>({
  describeFailure,
  isComplete,
  onEvidence,
  read,
  timeoutMs,
}: ApiPollOptions<T>): Promise<ApiPollResult<T>> => {
  const startedAt = Date.now();
  let attempts = 0;
  let last: T | undefined;
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    try {
      last = await read();
      lastError = undefined;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: unknown }).status;
      const retryable =
        error instanceof TypeError ||
        (typeof status === "number" && [429, 502, 503, 504].includes(status));
      if (!retryable) {
        await onEvidence?.({
          attempts,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.name : "UnknownError",
        });
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10_000, attempts * 1000))
      );
      continue;
    }
    const failure = describeFailure?.(last);
    if (failure) {
      await onEvidence?.({
        attempts,
        elapsedMs: Date.now() - startedAt,
        error: failure,
        value: last,
      });
      throw new Error(failure);
    }
    if (isComplete(last)) {
      const result = { attempts, elapsedMs: Date.now() - startedAt, value: last };
      await onEvidence?.(result);
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, attempts * 1000)));
  }
  const elapsedMs = Date.now() - startedAt;
  await onEvidence?.({
    attempts,
    elapsedMs,
    error: lastError instanceof Error ? lastError.name : "TimeoutError",
    value: last,
  });
  throw new Error(`Timed out after ${elapsedMs}ms; attempts=${attempts}`);
};
