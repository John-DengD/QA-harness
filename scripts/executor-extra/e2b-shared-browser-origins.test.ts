import { afterEach, describe, expect, it } from "vitest";
import { chromeLaunchCommand, targetOrigin } from "../../src/tools/e2b-shared-browser";

// Harness patch: the harness resolves the test origin itself (from the PR sandbox comment or E2E_BASE_URL)
// and passes it in QA_ALLOWED_ORIGINS, so the allow-list is not frozen into the executor.
describe("QA_ALLOWED_ORIGINS", () => {
  afterEach(() => { delete process.env.QA_ALLOWED_ORIGINS; });

  it("still rejects an unknown origin by default", () => {
    expect(() => targetOrigin("https://example.invalid")).toThrow(/known Hellyeah test origin/);
  });
  it("allows exactly the origins the harness names", () => {
    process.env.QA_ALLOWED_ORIGINS = "https://dashboard-xyz.example.test, https://other.example.test";
    expect(targetOrigin("https://dashboard-xyz.example.test/some/path")).toBe("https://dashboard-xyz.example.test");
    expect(() => targetOrigin("https://evil.example.test")).toThrow(/known Hellyeah test origin/);
  });
  it("never allows credentials in the URL, even for an allowed origin", () => {
    process.env.QA_ALLOWED_ORIGINS = "https://dashboard-xyz.example.test";
    expect(() => targetOrigin("https://user:pw@dashboard-xyz.example.test")).toThrow(/without credentials/);
  });
  it("the Chrome launch command accepts an allowed origin", () => {
    process.env.QA_ALLOWED_ORIGINS = "https://dashboard-xyz.example.test";
    expect(chromeLaunchCommand(":0", "https://dashboard-xyz.example.test")).toContain("dashboard-xyz.example.test");
  });
});
