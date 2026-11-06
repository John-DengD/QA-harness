export type RuntimeEnvironment = Record<string, string | undefined>;

const value = (input: string | undefined, fallback: string): string =>
  input?.trim() || fallback;

const runnerUrl = (env: RuntimeEnvironment): string => {
  const server = env.GITHUB_SERVER_URL?.replace(/\/+$/, "");
  const repository = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  return server && repository && runId
    ? `${server}/${repository}/actions/runs/${runId}`
    : "local";
};

export const buildReportMetadata = (
  env: RuntimeEnvironment
): Record<string, string> => ({
  release: value(env.E2E_RELEASE, "local"),
  commitSha: value(env.E2E_COMMIT_SHA, "local"),
  runId: value(env.E2E_RUN_ID, "local"),
  correlationId: value(env.E2E_CORRELATION_ID, "local"),
  environment: value(env.E2E_SOURCE_ENVIRONMENT, "local"),
  targetUrl: value(env.E2E_BASE_URL, "http://localhost"),
  sourceRepository: value(env.E2E_SOURCE_REPOSITORY, "local"),
  sourceRunId: value(env.E2E_SOURCE_RUN_ID, "local"),
  sourceRunAttempt: value(env.E2E_SOURCE_RUN_ATTEMPT, "local"),
  upstreamRunUrl: value(env.E2E_UPSTREAM_RUN_URL, "local"),
  runnerRepository: value(env.GITHUB_REPOSITORY, "finalroundai/hy_ui_autotest"),
  runnerRunUrl: runnerUrl(env),
});
