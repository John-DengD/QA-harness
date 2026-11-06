import { describe, expect, it } from "vitest";

import { buildE2bTestenv } from "../../src/e2b-testenv";

const testValues = {
  E2E_ACCOUNT_EMAIL: "qa@example.test",
  CLERK_PUBLISHABLE_KEY: "pk_test_example",
  CLERK_SECRET_KEY: "sk_test_example",
  E2E_ADMIN_PASSWORD: "example-password",
  E2B_API_KEY: "e2b_example",
  UNRELATED_SECRET: "do-not-transfer",
};

describe("E2B testenv", () => {
  it("passes only approved test credentials to the guest", () => {
    expect(buildE2bTestenv(testValues)).toEqual({
      E2E_ACCOUNT_EMAIL: "qa@example.test",
      CLERK_PUBLISHABLE_KEY: "pk_test_example",
      CLERK_SECRET_KEY: "sk_test_example",
      E2E_ADMIN_PASSWORD: "example-password",
    });
  });

  it("fails before sandbox creation when required test credentials are absent or live", () => {
    expect(() => buildE2bTestenv({ ...testValues, E2E_ACCOUNT_EMAIL: "" })).toThrow(
      /E2E_ACCOUNT_EMAIL/
    );
    expect(() => buildE2bTestenv({ ...testValues, CLERK_SECRET_KEY: "sk_live_example" })).toThrow(
      /must be a test key/
    );
  });
});
