import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadActionCatalog, selectActions, validateActionCatalog, type ActionCatalogEntry } from "../../src/tools/action-select";
import { actionIndex, type ActionEntry } from "../../src/tools/action-index";

const entry = (name: string, domain: string, hot = false): ActionEntry => ({
  name, domain, file: `src/actions/${domain}-actions.ts`, line: 1, signature: "", hot,
});

describe("structured Action selection", () => {
  const entries = [
    entry("selectOrganization", "meta-byo", true),
    entry("openCampaignList", "campaign", true),
    entry("openCampaignComposer", "campaign"),
    entry("readWalletBalanceAndTransactions", "wallet"),
    entry("submitCampaignLaunch", "campaign"),
    entry("signInAdmin", "admin-auth"),
  ];
  const catalog: Record<string, ActionCatalogEntry> = {
    selectOrganization: {
      intent: "切换当前组织", aliases: ["switch org", "切换组织"], rollback: "reversible", undoneBy: "selectOrganization",
      surfaces: ["dashboard"], roles: ["user"], pages: ["organization-menu"], providedFacts: ["active-organization"],
      verification: "reviewed",
    },
    openCampaignList: {
      intent: "打开 Campaign 列表", aliases: ["open campaign list"], rollback: "read",
      surfaces: ["dashboard"], roles: ["user"], pages: ["campaign-list"], providedFacts: ["campaign-list"],
      verification: "reviewed",
    },
    openCampaignComposer: { intent: "打开新建 Campaign 页", rollback: "read" },
    readWalletBalanceAndTransactions: {
      intent: "读取钱包余额与交易", aliases: ["查看钱包余额"], rollback: "read",
      surfaces: ["dashboard"], roles: ["user"], pages: ["wallet"], providedFacts: ["wallet-balance"],
      verification: "candidate",
    },
    submitCampaignLaunch: { intent: "提交 Campaign launch", rollback: "irreversible", undoneBy: null },
    signInAdmin: {
      intent: "用账号密码登录 Admin 后台", aliases: ["admin sign in with password"], rollback: "reversible",
      undoneBy: null, undoNote: "no admin sign-out Action", denied: "password in --args-json",
    },
  };

  it("matches the intent, aliases and Chinese text through the table", () => {
    expect(selectActions(entries, catalog, {
      intent: "切换组织", domain: "meta-byo", sharedExecution: true,
    })[0].action.name).toBe("selectOrganization");
    expect(selectActions(entries, catalog, { intent: "切换当前组织" })[0].action.name).toBe("selectOrganization");
  });

  it("ranks the Action whose intent is an exact match first", () => {
    const result = selectActions(entries, catalog, { intent: "打开 Campaign 列表" });
    expect(result[0]).toMatchObject({ action: { name: "openCampaignList" }, exact: true });
  });

  it("keeps every Action that is not denied for shared execution, and reports missing facts", () => {
    // Shared execution is default-allow: an unreviewed Action is still a shared
    // candidate; only the denylist removes one.
    expect(selectActions(entries, catalog, {
      intent: "查看钱包余额", sharedExecution: true,
    }).map((item) => item.action.name)).toEqual(["readWalletBalanceAndTransactions"]);
    expect(selectActions(entries, catalog, {
      intent: "admin sign in with password", sharedExecution: true,
    })).toEqual([]);
    expect(selectActions(entries, catalog, {
      intent: "admin sign in with password",
    }).map((item) => item.action.name)).toEqual(["signInAdmin"]);
    expect(selectActions(entries, catalog, { intent: "submit campaign launch", sharedExecution: true })
      .map((item) => item.action.name)).toEqual(["submitCampaignLaunch"]);
    const result = selectActions(entries, catalog, {
      intent: "查看钱包余额", requiredFacts: ["wallet-transactions"],
    });
    expect(result[0]).toMatchObject({
      action: { name: "readWalletBalanceAndTransactions" },
      eligible: false,
      missingFacts: ["wallet-transactions"],
    });
  });

  it("filters by rollback level when asked, without making it a gate", () => {
    expect(selectActions(entries, catalog, { intent: "campaign", rollbackAllowed: "read" })
      .map((item) => item.action.name).sort()).toEqual(["openCampaignComposer", "openCampaignList"]);
    expect(selectActions(entries, catalog, { intent: "campaign" }).map((item) => item.action.name))
      .toContain("submitCampaignLaunch");
  });

  it("does not treat unknown context metadata as a hard match in strict mode", () => {
    const result = selectActions(entries, catalog, {
      intent: "open campaign list", page: "campaign-list", strictContext: true,
    });
    expect(result.map((item) => item.action.name)).toEqual(["openCampaignList"]);
  });

  it("does not return every Action in a domain for a multi-word query", () => {
    expect(selectActions(entries, catalog, { intent: "open campaign list" }).map((item) => item.action.name))
      .toEqual(["openCampaignList"]);
  });

  it("rejects stale rows, missing rows and the retired sharedExecution / sideEffect fields", () => {
    expect(() => validateActionCatalog(entries, { ...catalog, missingAction: { intent: "未知", rollback: "read" } }))
      .toThrow(/missingAction.*no exported Action/);
    const partial = { ...catalog };
    delete partial.openCampaignComposer;
    expect(() => validateActionCatalog(entries, partial)).toThrow(/openCampaignComposer has no row/);
    expect(() => validateActionCatalog(entries, {
      ...catalog, openCampaignList: { ...catalog.openCampaignList, sharedExecution: true } as ActionCatalogEntry,
    })).toThrow(/sharedExecution/);
    expect(() => validateActionCatalog(entries, {
      ...catalog, openCampaignComposer: { intent: "打开新建 Campaign 页", rollback: "read", sideEffect: "read" } as ActionCatalogEntry,
    })).toThrow(/sideEffect/);
    expect(() => validateActionCatalog(entries, catalog)).not.toThrow();
  });

  it("keeps the real table complete and consistent", async () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const real = await actionIndex(root, []);
    const realCatalog = await loadActionCatalog(root);
    expect(() => validateActionCatalog(real, realCatalog)).not.toThrow();
  });
});
