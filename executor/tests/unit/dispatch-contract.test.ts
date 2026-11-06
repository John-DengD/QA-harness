import { describe, expect, it } from "vitest";

import { validateDispatchSource } from "../../src/tools/dispatch-contract";

const valid = {
  actor: "finalround-ci[bot]",
  appSlug: "finalround-ci",
  baseUrl: "https://app-staging.hellyeahai.com",
  commitSha: "4585e9793a4a3399c608e163e765d93d5adf1701",
  contractVersion: "1",
  correlationId: "hy-123456789-1",
  dispatchEventType: "staging-production-release",
  environment: "staging",
  eventName: "repository_dispatch",
  sourceRepository: "finalroundai/hellyeah-v2",
};

describe("validateDispatchSource", () => {
  it("accepts the configured GitHub App dispatch contract", () => {
    expect(() => validateDispatchSource(valid)).not.toThrow();
  });

  it("rejects a different source repository", () => {
    expect(() =>
      validateDispatchSource({ ...valid, sourceRepository: "someone/fork" })
    ).toThrow("source repository is not allowed");
  });

  it("rejects a different repository dispatch event", () => {
    expect(() =>
      validateDispatchSource({ ...valid, dispatchEventType: "sandbox-ready" })
    ).toThrow("event type is not allowed");
  });

  it("rejects a non-App actor", () => {
    expect(() => validateDispatchSource({ ...valid, actor: "octocat" })).toThrow(
      "actor is not the configured GitHub App"
    );
  });

  it("allows manual workflow dispatch without App metadata", () => {
    expect(() =>
      validateDispatchSource({ eventName: "workflow_dispatch" })
    ).not.toThrow();
  });
});
