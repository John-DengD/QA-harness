export interface ReleaseGateInput {
  baseUrl: string;
  commitSha: string;
  correlationId: string;
  release: string;
  repository: string;
  sourceRepository: string;
  sourceRunAttempt: string;
  sourceRunId: string;
  token: string;
  upstreamRunUrl: string;
}

export interface ReleaseWorkflowRun {
  conclusion: string | null;
  display_title: string;
  html_url: string;
  id: number;
  status: string;
}

interface ReleaseGateOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  pollIntervalMs?: number;
  /** Throw when the downstream run does not conclude successfully. */
  requireSuccess?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CORRELATION = /^[A-Za-z0-9][A-Za-z0-9_-]{2,119}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/i;

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const requireValidInput = (input: ReleaseGateInput) => {
  if (!REPOSITORY.test(input.repository)) {
    throw new Error("E2E repository must use the owner/repository format");
  }
  if (!CORRELATION.test(input.correlationId)) {
    throw new Error("E2E correlation ID contains unsupported characters");
  }
  if (!COMMIT_SHA.test(input.commitSha)) {
    throw new Error("E2E commit SHA must contain 40 hexadecimal characters");
  }
  if (input.sourceRepository !== "finalroundai/hellyeah-v2") {
    throw new Error("E2E source repository is not allowed");
  }
  if (!input.token) throw new Error("E2E repository token is required");
};

export const runReleaseGate = async (
  input: ReleaseGateInput,
  options: ReleaseGateOptions = {}
): Promise<ReleaseWorkflowRun> => {
  requireValidInput(input);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const requireSuccess = options.requireSuccess ?? true;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const apiBase = `https://api.github.com/repos/${input.repository}`;
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${input.token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
  const dispatchedAt = new Date(now() - 60_000).toISOString();
  const dispatch = await fetcher(`${apiBase}/dispatches`, {
    body: JSON.stringify({
      client_payload: {
        baseUrl: input.baseUrl,
        commitSha: input.commitSha,
        contractVersion: 1,
        correlationId: input.correlationId,
        environment: "staging",
        release: input.release,
        sourceRepository: input.sourceRepository,
        sourceRunAttempt: input.sourceRunAttempt,
        sourceRunId: input.sourceRunId,
        upstreamRunUrl: input.upstreamRunUrl,
      },
      event_type: "staging-production-release",
    }),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!dispatch.ok) {
    throw new Error(`Could not dispatch Release E2E (${dispatch.status})`);
  }

  const deadline = now() + timeoutMs;
  const title = `Release E2E / ${input.correlationId}`;
  while (now() < deadline) {
    const query = new URLSearchParams({
      created: `>=${dispatchedAt}`,
      event: "repository_dispatch",
      per_page: "50",
    });
    const response = await fetcher(
      `${apiBase}/actions/workflows/release-e2e.yml/runs?${query}`,
      {
        headers,
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!response.ok) {
      throw new Error(`Could not read Release E2E status (${response.status})`);
    }
    const body = (await response.json()) as {
      workflow_runs?: ReleaseWorkflowRun[];
    };
    const run = body.workflow_runs?.find(
      (candidate) => candidate.display_title === title
    );
    if (run?.status === "completed") {
      if (requireSuccess && run.conclusion !== "success") {
        throw new Error(
          `Release E2E concluded with ${run.conclusion ?? "unknown"}: ${run.html_url}`
        );
      }
      return run;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Release E2E timed out after ${Math.round(timeoutMs / 60_000)}m`);
};
