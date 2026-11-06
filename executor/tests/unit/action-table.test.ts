import path from "node:path";
import { describe, expect, it } from "vitest";

import { actionIndex, type ActionEntry } from "../../src/tools/action-index";
import {
  ROLLBACK_LEVELS,
  actionTableEntry,
  legacyRollback,
  loadActionTable,
  normalizeIntent,
  resolveIntent,
  validateActionTable,
  type ActionTableEntry,
} from "../../src/tools/action-table";
import { SHARED_ACTION_DENYLIST, sharedActionDenial } from "../../src/tools/shared-action-policy";

const root = path.resolve(import.meta.dirname, "../..");

describe("the Action table covers the whole library", () => {
  it("has one row with an intent and a rollback level for every exported Action, and no stale rows", async () => {
    const entries = await actionIndex(root, []);
    const table = loadActionTable(root);
    const missing = entries.filter((entry) => !Object.hasOwn(table, entry.name)).map((entry) => entry.name);
    expect(missing, "Actions without a table row").toEqual([]);
    const names = new Set(entries.map((entry) => entry.name));
    expect(Object.keys(table).filter((name) => !names.has(name)), "rows without an Action").toEqual([]);
    for (const entry of entries) {
      const row = table[entry.name];
      expect(typeof row.intent === "string" && row.intent.trim().length > 0, entry.name).toBe(true);
      expect(ROLLBACK_LEVELS, entry.name).toContain(row.rollback);
    }
    expect(() => validateActionTable(entries, table, sharedActionDenial)).not.toThrow();
  });

  it("maps every intent to exactly one Action", () => {
    const table = loadActionTable(root);
    const seen = new Map<string, string>();
    for (const [name, row] of Object.entries(table)) {
      for (const text of [row.intent, ...(row.aliases ?? [])]) {
        const key = normalizeIntent(text);
        const owner = seen.get(key);
        expect(owner === undefined || owner === name, `"${text}" is used by ${owner} and ${name}`).toBe(true);
        seen.set(key, name);
      }
    }
  });

  it("names a real undo Action for every reversible row that has one", async () => {
    const names = new Set((await actionIndex(root, [])).map((entry) => entry.name));
    const table = loadActionTable(root);
    for (const [name, row] of Object.entries(table)) {
      if (row.undoneBy) expect(names.has(row.undoneBy), `${name}.undoneBy ${row.undoneBy}`).toBe(true);
      if (row.rollback === "reversible") {
        expect(Object.hasOwn(row, "undoneBy"), `${name} must say what undoes it`).toBe(true);
        if (row.undoneBy === null) expect(row.undoNote?.trim(), `${name} needs undoNote`).toBeTruthy();
      } else {
        expect(row.undoneBy ?? null, `${name} is ${row.rollback}; only reversible rows name an undo Action`).toBeNull();
      }
    }
  });

  it("records the agreed undo pairs and the irreversible end points", () => {
    expect(actionTableEntry("confirmSwitchToTraffic")).toMatchObject({ rollback: "reversible", undoneBy: "switchDraftBackFromTraffic" });
    expect(actionTableEntry("switchDraftBackFromTraffic")).toMatchObject({ rollback: "reversible", undoneBy: "confirmSwitchToTraffic" });
    expect(actionTableEntry("adminTopUpOrganization")).toMatchObject({ rollback: "reversible", undoneBy: "reverseAdminTopUp" });
    expect(actionTableEntry("startOverCampaignDraft")).toMatchObject({ undoneBy: "resumeSavedCampaignDraft" });
    expect(actionTableEntry("clearMetaBrandApp")).toMatchObject({ undoneBy: "restoreMetaBrandProfile" });
    for (const name of ["reverseAdminTopUp", "removeAdminMember", "submitCampaignLaunch", "cancelCustomerCampaignOnce",
      "approveAdminCampaignOnce", "submitWalletPayment", "submitCampaignGoal"]) {
      expect(actionTableEntry(name)?.rollback, name).toBe("irreversible");
    }
    for (const name of ["openSwitchToTrafficDialog", "keepGoalInTrafficDialog", "selectSettingsTab", "readGoogleTrackingReadiness"]) {
      expect(actionTableEntry(name)?.rollback, name).toBe("read");
    }
  });

  it("records the user's rollback rulings for the formerly uncertain Actions", () => {
    expect(actionTableEntry("continueOrganizationSetup")).toMatchObject({ rollback: "reversible", undoneBy: null });
    expect(actionTableEntry("continueOrganizationSetup")?.undoNote).toContain("不新建组织");
    for (const name of ["confirmCampaignCreativeImport", "bindSelectedMetaPage", "saveInstantForm"]) {
      expect(actionTableEntry(name), name).toMatchObject({ rollback: "reversible", undoneBy: name });
    }
    for (const name of ["confirmOnboardingBrand", "skipOnboardingInvite"]) {
      expect(actionTableEntry(name), name).toMatchObject({ rollback: "reversible", undoneBy: "resetOnboardingDraft" });
      expect(actionTableEntry(name)?.undoNote, name).toContain("start over");
    }
    // Discarding the onboarding draft itself stays irreversible.
    expect(actionTableEntry("resetOnboardingDraft")?.rollback).toBe("irreversible");
    expect(actionTableEntry("continueStudioToStyle")).toMatchObject({ rollback: "reversible", undoneBy: "reopenStudioProductBrief" });
    expect(actionTableEntry("shuffleStudioReferences")).toMatchObject({ rollback: "read" });
    for (const row of Object.values(loadActionTable(root))) {
      expect(row.undoNote ?? "", row.intent).not.toContain("拿不准");
    }
  });

  it("gives every denied Action a row that says why, and only those", () => {
    const table = loadActionTable(root);
    for (const name of Object.keys(SHARED_ACTION_DENYLIST)) {
      expect(table[name]?.denied, name).toBeTruthy();
    }
    expect(Object.entries(table).filter(([name, row]) => row.denied && !SHARED_ACTION_DENYLIST[name]).map(([name]) => name))
      .toEqual([]);
  });

  it("resolves an intent or alias to its Action", () => {
    const table = loadActionTable(root);
    expect(resolveIntent(table, "把草稿切到 Traffic")).toBe("confirmSwitchToTraffic");
    expect(resolveIntent(table, "  读取 CAMPAIGN 类型 ")).toBe("observeCampaignType");
    expect(resolveIntent(table, "切换组织")).toBe("selectOrganization");
    expect(resolveIntent(table, "no such intent")).toBeUndefined();
  });

  it("maps the retired caller-supplied levels onto rollback levels", () => {
    expect(legacyRollback("read")).toBe("read");
    expect(legacyRollback("reversible")).toBe("reversible");
    expect(legacyRollback("side_effect")).toBe("irreversible");
    expect(legacyRollback("irreversible_high_impact")).toBe("irreversible");
    expect(() => legacyRollback("whatever")).toThrow(/rollback/);
  });
});

describe("validateActionTable", () => {
  const entry = (name: string): ActionEntry => ({ name, domain: "campaign", file: "src/actions/campaign-actions.ts", line: 1, signature: "", hot: false });
  const entries = [entry("openList"), entry("switchOn"), entry("switchOff"), entry("signInAdmin")];
  const table = (): Record<string, ActionTableEntry> => ({
    openList: { intent: "打开列表", rollback: "read" },
    switchOn: { intent: "打开开关", rollback: "reversible", undoneBy: "switchOff" },
    switchOff: { intent: "关闭开关", rollback: "reversible", undoneBy: "switchOn" },
    signInAdmin: { intent: "管理员密码登录", rollback: "reversible", undoneBy: null, undoNote: "no sign-out", denied: "password" },
  });
  const denial = (name: string) => name === "signInAdmin" ? "secret" : undefined;

  it("accepts a complete, consistent table", () => {
    expect(() => validateActionTable(entries, table(), denial)).not.toThrow();
  });

  it("rejects missing and stale rows", () => {
    const missing = table();
    delete (missing as Record<string, unknown>).openList;
    expect(() => validateActionTable(entries, missing, denial)).toThrow(/openList has no row/);
    expect(() => validateActionTable(entries, { ...table(), ghost: { intent: "幽灵", rollback: "read" } }, denial))
      .toThrow(/ghost.*no exported Action/);
  });

  it("rejects a duplicate intent, a dangling undoneBy, and the retired sideEffect field", () => {
    expect(() => validateActionTable(entries, { ...table(), switchOff: { intent: "打开开关 ", rollback: "read" } }, denial))
      .toThrow(/intent .* switchOn and switchOff|used by switchOn and switchOff/);
    expect(() => validateActionTable(entries, { ...table(), switchOn: { intent: "打开开关", rollback: "reversible", undoneBy: "nope" } }, denial))
      .toThrow(/undoneBy nope/);
    expect(() => validateActionTable(entries, { ...table(), switchOn: { intent: "打开开关", rollback: "reversible" } }, denial))
      .toThrow(/undoneBy/);
    expect(() => validateActionTable(entries, { ...table(), openList: { intent: "打开列表", rollback: "read", sideEffect: "read" } as ActionTableEntry }, denial))
      .toThrow(/sideEffect/);
    expect(() => validateActionTable(entries, { ...table(), openList: { intent: "打开列表", rollback: "side_effect" } as unknown as ActionTableEntry }, denial))
      .toThrow(/rollback/);
  });

  it("keeps the denied marker in step with the denylist", () => {
    const { denied: _denied, ...signIn } = table().signInAdmin;
    expect(() => validateActionTable(entries, { ...table(), signInAdmin: signIn }, denial)).toThrow(/denied/);
    expect(() => validateActionTable(entries, { ...table(), openList: { intent: "打开列表", rollback: "read", denied: "x" } }, denial))
      .toThrow(/denied/);
  });

  it("accepts read expectations only on observation rows and only in a well-formed shape", () => {
    const read = (extra: Partial<ActionTableEntry>) => ({ ...table(), openList: { intent: "打开列表", rollback: "read" as const, ...extra } });
    expect(() => validateActionTable(entries, read({ mustHaveValue: ["cardCount"], allowedValues: { cardState: ["missing", "live"] } }), denial))
      .not.toThrow();
    expect(() => validateActionTable(entries, { ...table(), switchOn: { ...table().switchOn, mustHaveValue: ["x"] } }, denial))
      .toThrow(/only an observation \(rollback=read\) row/);
    expect(() => validateActionTable(entries, read({ mustHaveValue: [] }), denial)).toThrow(/mustHaveValue/);
    expect(() => validateActionTable(entries, read({ mustHaveValue: ["a", "a"] }), denial)).toThrow(/mustHaveValue/);
    expect(() => validateActionTable(entries, read({ allowedValues: { cardState: [] } }), denial)).toThrow(/allowedValues/);
    expect(() => validateActionTable(entries, read({ allowedValues: ["missing"] } as unknown as Partial<ActionTableEntry>), denial))
      .toThrow(/allowedValues/);
  });
});

describe("validateActionTable: drift sentinels and pinned", () => {
  const entry = (name: string): ActionEntry => ({ name, domain: "campaign", file: "src/actions/campaign-actions.ts", line: 1, signature: "", hot: false });
  const entries = [entry("readCard"), entry("switchOn")];
  const table = (extra: Partial<ActionTableEntry> = {}, onSwitch: Partial<ActionTableEntry> = {}): Record<string, ActionTableEntry> => ({
    readCard: { intent: "读卡片", rollback: "read", ...extra },
    switchOn: { intent: "打开开关", rollback: "reversible", undoneBy: null, undoNote: "手动", ...onSwitch },
  });
  const denial = () => undefined;

  it("accepts driftSentinels on observation rows and pinned on any row", () => {
    expect(() => validateActionTable(entries, table({ driftSentinels: { cardState: ["unrecognized"] }, pinned: true }, { pinned: false }), denial))
      .not.toThrow();
  });

  it("rejects malformed sentinels, sentinels on a write row and a non-boolean pinned", () => {
    expect(() => validateActionTable(entries, table({ driftSentinels: { cardState: [] } }), denial)).toThrow(/driftSentinels/);
    expect(() => validateActionTable(entries, table({ driftSentinels: ["unrecognized"] } as unknown as Partial<ActionTableEntry>), denial))
      .toThrow(/driftSentinels/);
    expect(() => validateActionTable(entries, table({}, { driftSentinels: { cardState: ["unrecognized"] } }), denial))
      .toThrow(/rollback=read/);
    expect(() => validateActionTable(entries, table({ pinned: "yes" } as unknown as Partial<ActionTableEntry>), denial)).toThrow(/pinned/);
  });

  it("rejects a sentinel that is also an allowed value", () => {
    expect(() => validateActionTable(entries, table({ allowedValues: { cardState: ["live", "unrecognized"] },
      driftSentinels: { cardState: ["unrecognized"] } }), denial)).toThrow(/driftSentinels/);
  });
});

describe("read expectations on the real table", () => {
  it("declares mustHaveValue/allowedValues for the observation Actions whose readings have a clear meaning", () => {
    const table = loadActionTable(root);
    expect(table.readGoogleTrackingReadiness.allowedValues?.cardState).not.toContain("unrecognized");
    expect(table.readGoogleTrackingReadiness.mustHaveValue).toContain("cardState");
    expect(table.readGoogleTrackingReadiness.driftSentinels?.cardState).toEqual(["unrecognized"]);
    expect(table.readGoogleTrackingReadiness.driftSentinels?.["readiness.conversionTrackingRow"]).toEqual(["unrecognized"]);
    expect(table.focusTrackingCardFromReadiness.driftSentinels?.cardState).toEqual(["unrecognized"]);
    for (const name of ["readCampaignStrategySummary", "observeStudioLibraryRuns", "observeStudioLibraryControls",
      "observeCampaignLaunchReadiness", "readWalletBalanceAndTransactions", "openSwitchToTrafficDialog"]) {
      expect(table[name].mustHaveValue?.length ?? 0, name).toBeGreaterThan(0);
      expect(table[name].rollback, name).toBe("read");
    }
  });
});
