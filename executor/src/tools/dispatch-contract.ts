export interface DispatchEnvironment {
  actor?: string;
  appSlug?: string;
  baseUrl?: string;
  commitSha?: string;
  contractVersion?: string;
  correlationId?: string;
  dispatchEventType?: string;
  environment?: string;
  eventName?: string;
  sourceRepository?: string;
}

const invalid = (message: string): never => {
  throw new Error(`[stage:dispatch-validation] ${message}`);
};

export const validateDispatchSource = (input: DispatchEnvironment): void => {
  if (input.eventName !== "repository_dispatch") return;
  if (input.contractVersion !== "1") {
    invalid("Unsupported or missing contractVersion");
  }
  if (input.dispatchEventType !== "staging-production-release") {
    invalid("Dispatch event type is not allowed");
  }
  if (input.sourceRepository !== "finalroundai/hellyeah-v2") {
    invalid("Dispatch source repository is not allowed");
  }
  if (input.environment !== "staging") {
    invalid("Dispatch environment must be staging");
  }
  if (input.baseUrl !== "https://app-staging.hellyeahai.com") {
    invalid("Dispatch target URL is not the canonical staging dashboard");
  }
  if (!/^[a-f0-9]{40}$/i.test(input.commitSha ?? "")) {
    invalid("Released commit SHA must contain 40 hexadecimal characters");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,119}$/.test(input.correlationId ?? "")) {
    invalid("Correlation ID contains unsupported characters");
  }
  const appSlug = input.appSlug?.trim();
  if (!appSlug) invalid("CI_GITHUB_APP_SLUG is not configured");
  if (input.actor !== `${appSlug}[bot]`) {
    invalid("Dispatch actor is not the configured GitHub App");
  }
};
