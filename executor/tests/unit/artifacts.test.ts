import { describe, expect, it } from "vitest";

import { shouldPublishArtifact } from "../../src/report/artifacts";

describe("shouldPublishArtifact", () => {
  it("keeps video, screenshots, and traces from successful runs", () => {
    expect(shouldPublishArtifact("test-results/run/video.webm", "passed")).toBe(
      true
    );
    expect(
      shouldPublishArtifact("test-results/run/stage-login.png", "passed")
    ).toBe(true);
    expect(shouldPublishArtifact("test-results/run/trace.zip", "passed")).toBe(
      true
    );
  });

  it("keeps video and trace for failed runs", () => {
    expect(shouldPublishArtifact("test-results/run/video.webm", "failed")).toBe(
      true
    );
    expect(shouldPublishArtifact("test-results/run/trace.zip", "failed")).toBe(
      true
    );
  });
});
