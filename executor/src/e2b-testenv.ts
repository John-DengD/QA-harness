const E2B_TESTENV_KEYS = [
  "E2E_ACCOUNT_EMAIL",
  "E2E_ACCOUNT_EMAIL2",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "E2E_ADMIN_EMAIL2",
  "E2E_ADMIN_PASSWORD2",
  "E2E_ADMIN_EMAIL3",
  "E2E_ADMIN_PASSWORD3",
  "E2E_CONTROL_URL",
  "E2E_EMAIL_BASE",
  "E2E_TEST_PASSWORD",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "STAGING_E2E_ADMIN_TOKEN",
] as const;

const REQUIRED_KEYS = [
  "E2E_ACCOUNT_EMAIL",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
] as const;

export function buildE2bTestenv(values: Record<string, string | undefined>): Record<string, string> {
  const missing = REQUIRED_KEYS.filter((key) => !values[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing E2B testenv values in qa-env/.env.local: ${missing.join(", ")}`);
  }
  if (!values.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("CLERK_SECRET_KEY in qa-env/.env.local must be a test key");
  }
  if (!values.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
    throw new Error("CLERK_PUBLISHABLE_KEY in qa-env/.env.local must be a test key");
  }

  const guestEnvs: Record<string, string> = {};
  for (const key of E2B_TESTENV_KEYS) {
    if (values[key]?.trim()) guestEnvs[key] = values[key]!;
  }
  return guestEnvs;
}
