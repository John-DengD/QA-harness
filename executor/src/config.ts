import { z } from "zod";

const normalizedUrl = z
  .url()
  .transform((value) => value.replace(/\/+$/, ""));

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const STAGING_HOSTNAMES = new Set([
  "app-staging.hellyeahai.com",
  "api-staging.hellyeahai.com",
  "ops-staging.hellyeahai.com",
]);
const DASHBOARD_SANDBOX_HOST =
  /^hellyeah-(?:dashboard|admin)-[a-z0-9-]+-final-round-ai\.vercel\.app$/;
const STAGING_API_URL = "https://api-staging.hellyeahai.com";
const CONTROL_PATH = "/internal/e2e";
const API_SANDBOX_HOST = /^api-server-pr-\d+\.up\.railway\.app$/;

const isNonProductionTarget = (hostname: string): boolean =>
  STAGING_HOSTNAMES.has(hostname) ||
  DASHBOARD_SANDBOX_HOST.test(hostname) ||
  API_SANDBOX_HOST.test(hostname);

const e2eTargetUrl = normalizedUrl.superRefine((value, ctx) => {
  const url = new URL(value);
  const isLoopback = LOOPBACK_HOSTNAMES.has(url.hostname);
  if (isLoopback && (url.protocol === "http:" || url.protocol === "https:")) {
    return;
  }
  if (url.protocol !== "https:") {
    ctx.addIssue({
      code: "custom",
      message: "must use HTTPS unless the target is localhost",
    });
    return;
  }
  if (!isNonProductionTarget(url.hostname)) {
    ctx.addIssue({
      code: "custom",
      message:
        "must target a known Hellyeah staging or PR sandbox hostname unless the target is localhost",
    });
  }
});

const httpsUrl = normalizedUrl.refine(
  (value) => new URL(value).protocol === "https:",
  "must use HTTPS"
);

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    schema.optional()
  );

const runtimeEnvSchema = z.object({
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_test_").min(12),
  CLERK_SECRET_KEY: z.string().startsWith("sk_test_").min(12),
  E2E_BASE_URL: e2eTargetUrl,
  E2E_API_URL: optional(e2eTargetUrl),
  E2E_CONTROL_URL: optional(e2eTargetUrl),
  E2E_EMAIL_BASE: z
    .email()
    .refine((value) => !value.split("@")[0]?.includes("+"), {
      message: "must not already contain plus addressing",
    }),
  E2E_TEST_PASSWORD: z.string().min(12),
  E2E_ACCOUNT_EMAIL: optional(z.email()),
  MIDSCENE_MODEL_API_KEY: z.string().min(1),
  MIDSCENE_MODEL_BASE_URL: httpsUrl,
  MIDSCENE_MODEL_FAMILY: z.enum([
    "gpt-5",
    "qwen2.5-vl",
    "qwen3-vl",
    "qwen3",
    "qwen3.5",
    "qwen3.6",
    "doubao-vision",
    "doubao-seed",
    "gemini",
    "vlm-ui-tars",
    "vlm-ui-tars-doubao",
    "vlm-ui-tars-doubao-1.5",
    "glm-v",
    "auto-glm",
    "auto-glm-multilingual",
    "deepseek",
    "kimi",
    "kimi3",
    "xiaomi-mimo",
  ]),
  MIDSCENE_MODEL_NAME: z.string().min(1),
  STAGING_E2E_ADMIN_TOKEN: z.string().min(32),
});

export interface RuntimeConfig {
  accountEmail: string;
  apiUrl: string;
  baseUrl: string;
  clerkPublishableKey: string;
  clerkSecretKey: string;
  controlToken: string;
  controlUrl: string;
  emailBase: string;
  modelApiKey: string;
  modelBaseUrl: string;
  modelFamily: string;
  modelName: string;
  testPassword: string;
}

export const parseRuntimeConfig = (
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): RuntimeConfig => {
  const result = runtimeEnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`[stage:healthcheck] Invalid E2E environment: ${issues}`);
  }

  const { apiUrl, controlUrl } = resolveBackendUrls(
    result.data.E2E_BASE_URL,
    result.data.E2E_API_URL,
    result.data.E2E_CONTROL_URL
  );

  return {
    accountEmail: result.data.E2E_ACCOUNT_EMAIL ?? result.data.E2E_EMAIL_BASE,
    apiUrl,
    baseUrl: result.data.E2E_BASE_URL,
    clerkPublishableKey: result.data.CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: result.data.CLERK_SECRET_KEY,
    controlToken: result.data.STAGING_E2E_ADMIN_TOKEN,
    controlUrl,
    emailBase: result.data.E2E_EMAIL_BASE,
    modelApiKey: result.data.MIDSCENE_MODEL_API_KEY,
    modelBaseUrl: result.data.MIDSCENE_MODEL_BASE_URL,
    modelFamily: result.data.MIDSCENE_MODEL_FAMILY,
    modelName: result.data.MIDSCENE_MODEL_NAME,
    testPassword: result.data.E2E_TEST_PASSWORD,
  };
};

type TargetEnvironment = "local" | "staging" | `sandbox:${string}`;

const environmentOf = (value: string): TargetEnvironment => {
  const { hostname } = new URL(value);
  if (LOOPBACK_HOSTNAMES.has(hostname)) return "local";
  if (STAGING_HOSTNAMES.has(hostname)) return "staging";
  const pr = /^api-server-pr-(\d+)\.up\.railway\.app$/.exec(hostname)?.[1];
  return pr ? `sandbox:${pr}` : "sandbox:dashboard";
};

const apiFromControl = (controlUrl: string): string =>
  controlUrl.replace(/\/internal\/e2e(?:\/.*)?$/, "");

/**
 * The control API (disposable-account scopes) and the read-only API must hit the
 * same backend as the UI under test: a PR target uses that PR's sandbox API, a
 * staging target uses staging. Loopback values are local-development defaults
 * from qa-env/.env.local and are ignored for remote targets.
 */
const resolveBackendUrls = (
  baseUrl: string,
  explicitApi: string | undefined,
  explicitControl: string | undefined
): { apiUrl: string; controlUrl: string } => {
  const target = environmentOf(baseUrl);
  if (target === "local") {
    if (!explicitControl) {
      throw new Error("[stage:healthcheck] Invalid E2E environment: E2E_CONTROL_URL is required for a local target");
    }
    return { apiUrl: explicitApi ?? apiFromControl(explicitControl), controlUrl: explicitControl };
  }
  const remote = (value: string | undefined) =>
    value && environmentOf(value) !== "local" ? value : undefined;
  const api = remote(explicitApi);
  const control = remote(explicitControl);
  const apiUrl = api ?? (control ? apiFromControl(control) : target === "staging" ? STAGING_API_URL : undefined);
  if (!apiUrl) {
    throw new Error(
      "[stage:healthcheck] Invalid E2E environment: a PR sandbox target needs E2E_API_URL (the API URL from the <!-- preview-sandbox --> comment)"
    );
  }
  const controlUrl = control ?? `${apiUrl}${CONTROL_PATH}`;
  const apiEnv = environmentOf(apiUrl);
  const expected = target === "staging" ? "staging" : apiEnv;
  const mismatched =
    (target === "staging" ? apiEnv !== "staging" : !apiEnv.startsWith("sandbox:") || apiEnv === "sandbox:dashboard") ||
    environmentOf(controlUrl) !== expected;
  if (mismatched) {
    throw new Error(
      "[stage:healthcheck] Invalid E2E environment: E2E_BASE_URL, E2E_API_URL and E2E_CONTROL_URL must point to the same environment (a PR target uses that sandbox's API; staging uses staging)"
    );
  }
  return { apiUrl, controlUrl };
};

