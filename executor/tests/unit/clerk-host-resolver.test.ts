import { describe, expect, it } from "vitest";

import { buildClerkHostResolverArgs } from "../../src/tools/clerk-host-resolver";

const PUBLISHABLE_KEY = `pk_test_${Buffer.from(
  "honest-tarpon-1.clerk.accounts.dev$"
).toString("base64")}`;

describe("buildClerkHostResolverArgs", () => {
  it("maps the Clerk FAPI host when a local fallback IP is configured", () => {
    expect(buildClerkHostResolverArgs(PUBLISHABLE_KEY, "172.64.153.110")).toEqual([
      "--host-resolver-rules=MAP honest-tarpon-1.clerk.accounts.dev 172.64.153.110",
    ]);
  });

  it("does not change browser DNS by default", () => {
    expect(buildClerkHostResolverArgs(PUBLISHABLE_KEY)).toEqual([]);
  });

  it("rejects an invalid fallback IP", () => {
    expect(() =>
      buildClerkHostResolverArgs(PUBLISHABLE_KEY, "127.0.0.1,EXCLUDE localhost")
    ).toThrow(/IP/i);
  });
});
