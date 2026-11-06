import { describe, expect, it } from "vitest";

import {
  SHARED_ACTION_DENYLIST,
  sanitizeSharedActionFact,
  sharedActionRollback,
  sharedActionDenial,
  validateSharedAction,
} from "../../src/tools/shared-action-policy";

// Stand-ins for library exports: execution bounds the argument count of an
// Action whose table row fixes none by its formal parameters (page excluded).
const zeroArgAction = async (page: unknown) => page;
const oneArgAction = async (page: unknown, slug: string) => [page, slug];
const sharedEnv = {
  E2E_ACCOUNT_EMAIL: "qa.primary@example.test",
  E2E_ACCOUNT_EMAIL2: "qa.secondary@example.test",
  E2E_ADMIN_EMAIL: "qa.admin@example.test",
  E2E_ADMIN_EMAIL3: "QA.Admin.RO@example.test",
  E2E_EMAIL_BASE: "qa.base@example.test",
};

describe("shared E2B Action policy", () => {
  it("permits audited read-only and reversible Actions with bounded arguments", () => {
    expect(() => validateSharedAction("openCampaignList", [])).not.toThrow();
    expect(() => validateSharedAction("openCampaignDraft", ["41674462-680b-495f-ac20-a5dafd0104dd"])).not.toThrow();
    expect(() => validateSharedAction("selectOrganization", ["QA 1 · No tracker"])).not.toThrow();
  });

  it("audits the Admin Dashboard Actions that carry no credentials", () => {
    expect(() => validateSharedAction("signInAdminFromEnv", [])).not.toThrow();
    expect(() => validateSharedAction("inspectAdminMemberPasswordPolicy", [])).not.toThrow();
    expect(() => validateSharedAction("inspectAdminMember", ["qa.member@example.test"])).not.toThrow();
  });

  it("keeps the password-taking admin sign-in out of shared execution", () => {
    // signInAdminFromEnv reads qa-env inside the process; signInAdmin would put
    // the password into --args-json, and from there into the shell history.
    expect(() => validateSharedAction("signInAdminFromEnv", ["admin@example.test", "password"])).toThrow("0 argument");
    expect(() => validateSharedAction("inspectAdminMember", ["not-an-email"])).toThrow("email address");
    expect(() => validateSharedAction("inspectAdminMember", ["qa@example.test\nX-Injected: 1"])).toThrow("email address");
  });

  it("blocks malformed arguments to Actions with a fixed argument count", () => {
    expect(() => validateSharedAction("selectOrganization", [])).toThrow("requires 1 argument");
    expect(() => validateSharedAction("openCampaignDraft", ["https://example.test/?token=abc"])).toThrow("requires a UUID");
    expect(() => validateSharedAction("selectOrganization", ["https://example.test/?token=abc"])).toThrow("short organization name");
  });

  it("audits the read-only Campaign and tracking observers with no arguments", () => {
    for (const name of [
      "openCampaignComposer", "waitForCampaignDraft", "observeCampaignDraftStable", "observeCampaignTypeLabel",
      "observeCampaignType", "observeCampaignKeywords", "observeCampaignCopyActions",
      "observeCampaignCreativeCards", "observeCampaignCreativePicker", "openCampaignCreativePicker",
      "closeCampaignCreativePicker", "expandCampaignCopyEditor", "observeCampaignBudget", "observeCampaignLaunchButton",
      "observeCampaignLaunchReadiness", "observeCampaignProtectiveActions", "readCampaignStrategySummary",
      "focusTrackingCardFromReadiness", "readTrackingSetupLink", "openSwitchToTrafficDialog",
      "keepGoalInTrafficDialog",
    ]) {
      expect(() => validateSharedAction(name, []), name).not.toThrow();
      expect(() => validateSharedAction(name, ["extra"]), name).toThrow("0 argument");
    }
    expect(() => validateSharedAction("openExistingCampaignDetail", ["41674462-680b-495f-ac20-a5dafd0104dd"])).not.toThrow();
    expect(() => validateSharedAction("openExistingCampaignDetail", ["../wallet"])).toThrow("UUID");
  });

  it("takes the rollback level from the Action table, not from the caller", () => {
    for (const name of ["confirmSwitchToTraffic", "switchDraftBackFromTraffic",
      "startOverCampaignDraft", "resumeSavedCampaignDraft", "selectOrganization"]) {
      expect(sharedActionRollback(name), name).toBe("reversible");
    }
    expect(() => validateSharedAction("confirmSwitchToTraffic", [])).not.toThrow();
    expect(() => validateSharedAction("retryCampaignChangesSave", [])).not.toThrow();
    for (const name of ["retryCampaignChangesSave", "submitCampaignGoal", "submitCampaignLaunch", "removeAdminMember"]) {
      expect(sharedActionRollback(name), name).toBe("irreversible");
    }
    expect(sharedActionRollback("openSwitchToTrafficDialog")).toBe("read");
    expect(() => sharedActionRollback("noSuchAction")).toThrow(/no row in the Action table/);
    expect(() => validateSharedAction("noSuchAction", [], zeroArgAction)).toThrow(/no row in the Action table/);
  });

  it("bounds the free-text goal that creates a Campaign draft", () => {
    const submit = (text: unknown) => () => validateSharedAction("submitCampaignGoal", [text]);
    expect(submit("Drive purchases for the online store with Google ads")).not.toThrow();
    for (const text of [
      "short", "x".repeat(301), "Drive purchases\nthen launch it", "Drive purchases\u0007 now",
      "Drive purchases for https://evil.example/?token=1", "Drive purchases for www.evil.example",
      "Email results to qa@example.test", "Drive <script>alert(1)</script> purchases", 42,
    ]) {
      expect(submit(text), String(text)).toThrow("Campaign goal");
    }
  });

  it("bounds the quick-goal chip label and the draft name", () => {
    const chip = (text: unknown) => () => validateSharedAction("submitCampaignGoalFromChip", [text]);
    expect(chip("Get more sales")).not.toThrow();
    for (const text of ["ab", "x".repeat(121), "Get\nsales", "Get <b>sales", "https://evil.example", "qa@example.test", 7]) {
      expect(chip(text), String(text)).toThrow("Campaign goal chip");
    }
    const rename = (text: unknown) => () => validateSharedAction("renameCampaignDraft", [text]);
    expect(rename("QA r-20261016-1815-action-heal Search Traffic")).not.toThrow();
    for (const text of ["", "   ", "x".repeat(256), "a\nb", "<i>x</i>", "see https://evil.example", "qa@example.test", null]) {
      expect(rename(text), String(text)).toThrow("Campaign rename");
    }
  });

  it("runs library Actions without a fixed argument count, launch included, bounded by their formal parameters", () => {
    // Shared execution is pinned to staging / PR sandbox origins, so launching
    // there spends test money only. An Action whose table row fixes no argument
    // count takes at most (formal parameters - page) arguments.
    expect(sharedActionDenial("submitCampaignLaunch")).toBeUndefined();
    expect(() => validateSharedAction("submitCampaignLaunch", [], zeroArgAction))
      .not.toThrow();
    expect(() => validateSharedAction("observeStudioLibraryControls", [], zeroArgAction)).not.toThrow();
    expect(() => validateSharedAction("observeStudioLibraryControls", ["extra"], zeroArgAction))
      .toThrow("at most 0 argument");
    expect(() => validateSharedAction("openWebsiteEventDetail", ["summer-mixer"], oneArgAction))
      .not.toThrow();
    expect(() => validateSharedAction("openWebsiteEventDetail", [], oneArgAction)).not.toThrow();
    expect(() => validateSharedAction("openWebsiteEventDetail", ["a", "b"], oneArgAction))
      .toThrow("at most 1 argument");
  });

  it("needs the imported function before it can bound an Action with no fixed argument count", () => {
    expect(() => validateSharedAction("observeStudioLibraryControls", []))
      .toThrow(/formal parameters/);
  });

  it("denies the Actions whose arguments are secrets, with the reason and the alternative", () => {
    for (const name of [
      "signInAdmin", "submitSignInPassword", "submitSignUpCredentials", "submitDeferredSignUpPassword",
      "submitSignInSecondFactor", "submitSignUpVerificationCode", "submitWalletPayment",
      "prepareWalletCardPayment", "createAdminMember",
    ]) {
      expect(SHARED_ACTION_DENYLIST[name], name).toBeTruthy();
      expect(sharedActionDenial(name), name).toMatch(/--args-json/);
      // Denial comes first: neither the table row nor the function can lift it.
      for (const attempt of [() => validateSharedAction(name, []),
        () => validateSharedAction(name, [], zeroArgAction)]) {
        expect(attempt, name).toThrow(/denied for shared E2B execution/);
        expect(attempt, name).toThrow(/FromEnv|Computer Use/);
      }
    }
    expect(() => validateSharedAction("signInAdmin", ["admin@example.test", "password"]))
      .toThrow(/shell history/);
  });

  it("removes a disposable admin member but never a shared QA account", () => {
    const remove = (email: unknown, env: Record<string, string | undefined> = sharedEnv) => () =>
      validateSharedAction("removeAdminMember", [{ email, name: "QA member" }], undefined, env);
    expect(sharedActionDenial("removeAdminMember")).toBeUndefined();
    expect(remove("qa.base+run-123@example.test")).not.toThrow();
    for (const email of ["qa.primary@example.test", "qa.secondary@example.test", "qa.admin@example.test",
      "qa.admin.ro@example.test", " QA.Secondary@Example.test "]) {
      expect(remove(email), email).toThrow(/shared QA account/);
    }
    expect(remove("not-an-email")).toThrow("email address");
    // Without qa-env the shared accounts are unknown, so nothing is removed.
    expect(remove("qa.base+run-123@example.test", {})).toThrow(/qa-env/);
    expect(() => validateSharedAction("removeAdminMember", [], undefined, sharedEnv)).toThrow("requires 1 argument");
  });

  it("removes query strings and fragments from persisted Action URL facts", () => {
    expect(sanitizeSharedActionFact({ url: "https://app-staging.hellyeahai.com/campaigns/new?draft=private#status",
      nested: { pageUrl: "/wallet?session=private", count: 2 } })).toEqual({
      url: "https://app-staging.hellyeahai.com/campaigns/new",
      nested: { pageUrl: "/wallet", count: 2 },
    });
  });
});
