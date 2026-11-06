import { describe, expect, it } from "vitest";

import { sanitizeReportManifest } from "../../src/report/manifest";

describe("sanitizeReportManifest", () => {
  it("redacts emails and removes secret-like metadata", () => {
    const manifest = sanitizeReportManifest({
      artifacts: [],
      cases: [],
      checkpoints: [],
      commitSha: "abc123",
      completedAt: "2026-09-01T01:01:00.000Z",
      metadata: {
        apiKey: "model-secret",
        email: "qa+clerk_test_run@hellyeahai.com",
        note: "release verification",
        password: "test-password",
      },
      release: "dashboard-42",
      runId: "run-42",
      startedAt: "2026-09-01T01:00:00.000Z",
      stages: [],
      status: "passed",
      version: 2,
    });

    expect(manifest.metadata).toEqual({
      email: "q***@hellyeahai.com",
      note: "release verification",
    });
    expect(JSON.stringify(manifest)).not.toMatch(/model-secret|test-password/);
  });
});
