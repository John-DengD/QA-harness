import { redactEmail } from "../tools/identity";

export type RunStatus = "passed" | "failed";
export type StageStatus = RunStatus | "warning";
export type FailureType =
  | "assertion"
  | "environment"
  | "product"
  | "teardown"
  | "visual";

export interface StageManifest {
  caseId?: string;
  durationMs: number;
  error?: string;
  failureType?: FailureType;
  name: string;
  status: StageStatus;
  tag?: string;
}

export interface CaseManifest {
  durationMs: number;
  id: string;
  stages: StageManifest[];
  status: RunStatus;
  tag: string;
}

export interface BackendCheckpointManifest {
  attempts: number;
  checkpoint: string;
  elapsedMs: number;
  terminal?: {
    checkpoint: string;
    metrics?: Record<string, string | number | boolean | null>;
    observedAt: string;
    reasonCode?: string;
    state: "pending" | "running" | "succeeded" | "failed";
  };
  transitions: Array<{
    checkpoint: string;
    metrics?: Record<string, string | number | boolean | null>;
    observedAt: string;
    reasonCode?: string;
    state: "pending" | "running" | "succeeded" | "failed";
  }>;
}

export type ArtifactKind = "html" | "screenshot" | "trace" | "video" | "data";

export interface ReportArtifact {
  expiresAt: string;
  kind: ArtifactKind;
  name: string;
  pathname: string;
  size: number;
}

export interface ReportManifest {
  artifacts: ReportArtifact[];
  checkpoints: BackendCheckpointManifest[];
  cases: CaseManifest[];
  commitSha: string;
  completedAt: string;
  metadata: Record<string, string>;
  release: string;
  runId: string;
  startedAt: string;
  stages: StageManifest[];
  status: RunStatus;
  version: 2;
}

const SECRET_KEY_PATTERN = /api.?key|authorization|password|secret|token/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const redactEmails = (value: string): string =>
  value.replace(EMAIL_PATTERN, (email) => redactEmail(email));

export const sanitizeReportManifest = (
  input: ReportManifest
): ReportManifest => {
  const metadata = Object.fromEntries(
    Object.entries(input.metadata)
      .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
      .map(([key, value]) => [key, redactEmails(value)])
  );
  return { ...input, metadata };
};
