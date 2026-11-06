import { describe, expect, it } from "vitest";

import { sharedActionRollback, validateSharedAction } from "../../src/tools/shared-action-policy";

const ORG = "cc5f783f-6426-4fb8-b576-ae710eeb80e7";

describe("admin billing Action policy", () => {
  it("accepts the audited billing Actions with well-formed arguments", () => {
    expect(() => validateSharedAction("openOrganizationTransactions", [ORG])).not.toThrow();
    expect(() => validateSharedAction("readAuditLogEntries", [])).not.toThrow();
    expect(() => validateSharedAction("adminTopUpOrganization", [ORG, "2.25"])).not.toThrow();
    expect(() => validateSharedAction("reverseAdminTopUp", [ORG, "QA acceptance run"])).not.toThrow();
  });

  it("requires an organization UUID rather than a path or a name", () => {
    for (const name of ["openOrganizationTransactions", "adminTopUpOrganization", "reverseAdminTopUp"]) {
      const args = name === "openOrganizationTransactions" ? ["QA 1 · No tracker"] : ["QA 1 · No tracker", "2.25"];
      expect(() => validateSharedAction(name, args)).toThrow("organization UUID");
    }
    expect(() => validateSharedAction("openOrganizationTransactions", ["../../audit"])).toThrow("organization UUID");
  });

  it("caps how much money a shared-browser top-up can move", () => {
    // Four digits, a negative, and a thousands separator all have to fail: this
    // Action moves real balance in a sandbox that forks staging data.
    expect(() => validateSharedAction("adminTopUpOrganization", [ORG, "1000"])).toThrow("999.99");
    expect(() => validateSharedAction("adminTopUpOrganization", [ORG, "-5"])).toThrow("999.99");
    expect(() => validateSharedAction("adminTopUpOrganization", [ORG, "1,000"])).toThrow("999.99");
    expect(() => validateSharedAction("adminTopUpOrganization", [ORG, "0"])).toThrow("999.99");
    expect(() => validateSharedAction("adminTopUpOrganization", [ORG, "2.255"])).toThrow("999.99");
  });

  it("requires a real single-line reversal reason", () => {
    expect(() => validateSharedAction("reverseAdminTopUp", [ORG, "oops"])).toThrow("8 to 300");
    expect(() => validateSharedAction("reverseAdminTopUp", [ORG, "valid reason\nX-Injected: 1"])).toThrow("8 to 300");
  });

  it("audits the extra operator sign-ins as zero-argument Actions", () => {
    for (const name of ["signInSecondAdminFromEnv", "signInReadOnlyAdminFromEnv"]) {
      expect(() => validateSharedAction(name, [])).not.toThrow();
      expect(() => validateSharedAction(name, ["someone@example.invalid"]))
        .toThrow("0 argument");
    }
  });

  it("records the top-up as reversible through reverseAdminTopUp, and the reversal as irreversible", () => {
    expect(sharedActionRollback("adminTopUpOrganization")).toBe("reversible");
    expect(sharedActionRollback("reverseAdminTopUp")).toBe("irreversible");
    expect(() => validateSharedAction("adminTopUpOrganization", [ORG])).toThrow("requires 2 argument");
  });
});
