import { describe, expect, it } from "vitest";

import {
  buildAttemptRunId,
  buildTestEmail,
  redactEmail,
} from "../../src/tools/identity";

describe("test identity", () => {
  it("builds a unique Clerk test-mode subaddress", () => {
    expect(buildTestEmail("qa@hellyeahai.com", "release-12_ABC")).toBe(
      "qa+clerk_test_release-12_abc@hellyeahai.com"
    );
  });

  it("redacts the local part in report output", () => {
    expect(redactEmail("qa+clerk_test_release-12@hellyeahai.com")).toBe(
      "q***@hellyeahai.com"
    );
  });

  it("uses an isolated identity for each Playwright retry", () => {
    expect(buildAttemptRunId("release-42", 0)).toBe("release-42");
    expect(buildAttemptRunId("release-42", 2)).toBe("release-42-retry-2");
  });
});
