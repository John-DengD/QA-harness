const SAFE_RUN_ID = /[^a-z0-9_-]+/g;

export const buildAttemptRunId = (runId: string, retry: number): string =>
  retry > 0
    ? `${runId.slice(0, 120 - `-retry-${retry}`.length)}-retry-${retry}`
    : runId;

export const buildTestEmail = (baseEmail: string, runId: string): string => {
  const [local, domain] = baseEmail.toLowerCase().split("@");
  if (!(local && domain)) {
    throw new Error("A valid base email is required");
  }
  const suffix = runId.toLowerCase().replace(SAFE_RUN_ID, "-").slice(0, 40);
  return `${local}+clerk_test_${suffix}@${domain}`;
};

export const redactEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!(local && domain)) return "[redacted-email]";
  return `${local[0]}***@${domain}`;
};
