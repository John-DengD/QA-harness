export const STAGE_PATTERN = /\[stage:[a-z0-9-]+\]/i;

export const stageError = (stage: string, message: string): Error =>
  new Error(`[stage:${stage}] ${message}`);

export const runStage = async <T>(
  stage: string,
  task: () => Promise<T>
): Promise<T> => {
  try {
    return await task();
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (!STAGE_PATTERN.test(normalized.message)) {
      normalized.message = `[stage:${stage}] ${normalized.message}`;
    }
    throw normalized;
  }
};
