import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { actionIndex, parseReuseLog, validateReuseEvent, type ActionEntry, type ReuseEvent } from "../../src/tools/action-index";
import { loadActionCatalog, type ActionCatalogEntry } from "../../src/tools/action-select";
import {
  LEGACY_REUSE_MISS_REASONS,
  REUSE_MISS_REASONS,
  browserPrimitiveIntent,
  findMissCandidates,
  prepareReuseMiss,
} from "../../src/tools/reuse-miss";

const entry = (name: string, domain = "campaign"): ActionEntry =>
  ({ name, domain, file: `src/actions/${domain}-actions.ts`, line: 1, signature: "", hot: false });

// Shared execution is default-allow: openCampaignList and the analytics fixture
// both run; signInAdmin is on the real denylist (its password would go through --args-json).
const entries = [
  entry("openCampaignList"),
  entry("openCampaignAnalyticsFixture"),
  entry("signInAdmin", "admin-auth"),
  entry("readWalletBalanceAndTransactions", "wallet"),
  entry("selectOrganization", "meta-byo"),
];
// Candidates are found through each row's intent (and its aliases).
const catalog: Record<string, ActionCatalogEntry> = {
  openCampaignAnalyticsFixture: { intent: "查看投放分析", aliases: ["open campaign analytics"], rollback: "read" },
  selectOrganization: { intent: "切换当前组织", aliases: ["switch organization", "切换组织"], rollback: "reversible", undoneBy: "selectOrganization" },
  signInAdmin: { intent: "管理员密码登录", aliases: ["admin password sign in"], rollback: "reversible",
    undoneBy: null, undoNote: "no admin sign-out Action", denied: "password in --args-json" },
};
const ctx = { entries, catalog, priorEvents: [] as ReuseEvent[] };
const base = { runId: "r1", caseId: "C1", source: "computer-use" as const, executionMs: 10 };

describe("reuse miss reasons", () => {
  it("writes denied instead of the retired not_allowlisted", () => {
    expect(REUSE_MISS_REASONS).toEqual([
      "absent", "not_found", "denied", "precondition", "drift", "unsafe", "novel", "other",
    ]);
    expect(LEGACY_REUSE_MISS_REASONS).toEqual(["not_allowlisted"]);
    for (const reason of ["denied", "not_allowlisted"]) {
      expect(() => validateReuseEvent({
        runId: "r", caseId: "c", intentId: "i", intent: "admin sign in", outcome: "miss",
        source: "computer-use", reason, action: "signInAdmin",
        lookupMs: 0, executionMs: 1,
      }), reason).not.toThrow();
    }
    expect(() => validateReuseEvent({
      runId: "r", caseId: "c", intentId: "i", intent: "x", outcome: "miss",
      source: "computer-use", reason: "no_action", lookupMs: 0, executionMs: 1,
    })).toThrow(/reason/);
  });

  it("still reads an old log whose misses say not_allowlisted", () => {
    const log = [
      { kind: "preflight", runId: "old", createdAt: "2026-10-01T00:00:00.000Z", indexedActions: 3, hotCandidates: [] },
      { runId: "old", caseId: "C1", intentId: "open-composer", intent: "open composer", outcome: "miss",
        source: "computer-use", reason: "not_allowlisted", action: "openCampaignComposer", lookupMs: 0, executionMs: 5 },
    ].map((line) => JSON.stringify(line)).join("\n");
    const run = parseReuseLog(log);
    expect(run.events[0].reason).toBe("not_allowlisted");
  });
});

describe("browser primitives are not business intents", () => {
  // The seven exp3 intents that were browser mechanics, logged as misses.
  it.each([
    ["c11-reload", "刷新页面（中断）"],
    ["c2-control-newtab", "对照：新开空白标签"],
    ["c2-close-controls", "关闭对照标签 2"],
    ["c6-return-draft-tab", "切回草稿标签"],
    ["c8-switch-away", "切到 tracker 设置标签（离开草稿标签）"],
    ["c8-switch-back", "切回草稿标签"],
    ["c9-close-setup-tab", "关闭 tracker 设置标签"],
    ["scroll-to-card", "scroll down to the card"],
    ["dismiss-dialog", "关闭浏览器弹窗"],
  ])("flags %s", (intentId, intent) => {
    expect(browserPrimitiveIntent(intentId, intent)).not.toBeNull();
  });

  it.each([
    ["c2-control-switch-org", "对照标签：打开 org 切换器"],
    ["close-picker", "close creative picker"],
    ["c3-open-switch-dialog", "点击卡片中的 Switch to Traffic"],
    ["c3-switch-back", "点 Switch Back to Sales"],
    ["retry-readiness", "Retry Check to refresh readiness"],
    ["c2-setup-tracking", "点 Set Up Tracking 打开 tracker 设置"],
    ["c11-resume", "点 Resume Draft"],
    ["c1-click-row", "点击 Readiness 中 Conversion tracking 行"],
    ["open-campaign-list", "打开 Campaigns 页"],
    ["c4-start-over", "点 Start Over 离开当前草稿"],
  ])("keeps the business intent %s", (intentId, intent) => {
    expect(browserPrimitiveIntent(intentId, intent)).toBeNull();
  });

  it("refuses to record a primitive as a miss", () => {
    expect(() => prepareReuseMiss({ ...base, intentId: "c6-return-draft-tab", intent: "切回草稿标签" }, ctx))
      .toThrow(/browser primitive/);
  });
});

describe("absent is checked against the Action library", () => {
  it("finds runnable and denied candidates by intent words", () => {
    expect(findMissCandidates(entries, catalog, "open-campaign-list", "打开 Campaigns 页")
      .map((candidate) => [candidate.name, candidate.denied]))
      .toContainEqual(["openCampaignList", false]);
    expect(findMissCandidates(entries, catalog, "x1", "查看投放分析").map((candidate) => candidate.name))
      .toEqual(["openCampaignAnalyticsFixture"]);
    expect(findMissCandidates(entries, catalog, "x2", "管理员密码登录")
      .map((candidate) => [candidate.name, candidate.denied])).toEqual([["signInAdmin", true]]);
  });

  it("finds a candidate through its table intent embedded in the miss text", () => {
    expect(findMissCandidates(entries, catalog, "c7", "在顶部切换当前组织到 QA 2").map((candidate) => candidate.name))
      .toContain("selectOrganization");
  });

  it("does not treat shared generic words as a candidate", () => {
    expect(findMissCandidates(entries, catalog, "open-campaign-forecast", "open campaign forecast")).toEqual([]);
  });

  it("rejects absent while a candidate exists and names the reason to use", () => {
    expect(() => prepareReuseMiss({ ...base, intentId: "open-campaign-list", intent: "打开 Campaigns 页" }, ctx))
      .toThrow(/openCampaignList \(runnable\).*not_found/s);
    // Any Action that is not denied is runnable: not_found / precondition / drift, never "not allowlisted".
    expect(() => prepareReuseMiss({ ...base, intentId: "c9", intent: "查看投放分析", reason: "absent" }, ctx))
      .toThrow(/openCampaignAnalyticsFixture \(runnable\).*not_found/s);
    expect(() => prepareReuseMiss({ ...base, intentId: "c10", intent: "管理员密码登录", reason: "absent" }, ctx))
      .toThrow(/signInAdmin \(denied\).*denied/s);
  });

  it("records absent when nothing matches, or once every candidate was reviewed", () => {
    expect(prepareReuseMiss({ ...base, intentId: "c3-open-switch-dialog", intent: "open the Switch to Traffic dialog" }, ctx))
      .toMatchObject({ outcome: "miss", reason: "absent", source: "computer-use", lookupMs: 0 });
    expect(prepareReuseMiss({
      ...base, intentId: "c9", intent: "查看投放分析",
      reviewedCandidates: ["openCampaignAnalyticsFixture"],
    }, ctx)).toMatchObject({ reason: "absent", reviewedCandidates: ["openCampaignAnalyticsFixture"] });
    expect(() => prepareReuseMiss({
      ...base, intentId: "c9", intent: "查看投放分析", reviewedCandidates: ["somethingElse"],
    }, ctx)).toThrow(/openCampaignAnalyticsFixture/);
  });

  it("records denied only for an indexed Action that the denylist really blocks", () => {
    expect(prepareReuseMiss({
      ...base, intentId: "c4", intent: "admin sign in", reason: "denied", action: "signInAdmin",
    }, ctx)).toMatchObject({ reason: "denied", action: "signInAdmin" });
    expect(() => prepareReuseMiss({ ...base, intentId: "c4", intent: "open", reason: "denied" }, ctx))
      .toThrow(/--miss-action/);
    expect(() => prepareReuseMiss({
      ...base, intentId: "c4", intent: "open analytics", reason: "denied", action: "openCampaignAnalyticsFixture",
    }, ctx)).toThrow(/not denied.*not_found, precondition or drift/s);
    expect(() => prepareReuseMiss({
      ...base, intentId: "c4", intent: "open", reason: "drift", action: "noSuchAction",
    }, ctx)).toThrow(/not an indexed Action/);
    expect(() => prepareReuseMiss({ ...base, intentId: "c4", intent: "open", reason: "drift" }, ctx))
      .toThrow(/--miss-action/);
  });

  it("refuses to write the retired not_allowlisted reason", () => {
    expect(() => prepareReuseMiss({
      ...base, intentId: "c4", intent: "open analytics", reason: "not_allowlisted",
      action: "openCampaignAnalyticsFixture",
    }, ctx)).toThrow(/not_allowlisted is retired.*denied/s);
  });

  it("keeps recording each intent ID only once", () => {
    const first = prepareReuseMiss({ ...base, intentId: "c3-open-switch-dialog", intent: "open dialog" }, ctx)!;
    expect(prepareReuseMiss({ ...base, intentId: "c3-open-switch-dialog", intent: "open dialog" },
      { ...ctx, priorEvents: [first] })).toBeNull();
  });

  it("rejects absent for the exp3 intents that the real library already covers", async () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const hot = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
    const real = { entries: await actionIndex(root, hot.actions), catalog: await loadActionCatalog(root), priorEvents: [] };
    expect(() => prepareReuseMiss({ ...base, intentId: "open-campaign-list", intent: "打开 Campaigns 页" }, real))
      .toThrow(/openCampaignList/);
    expect(() => prepareReuseMiss({ ...base, intentId: "open-campaign-composer", intent: "在地址栏打开 /campaigns/new" }, real))
      .toThrow(/openCampaignComposer/);
    expect(() => prepareReuseMiss({ ...base, intentId: "c2-control-switch-org", intent: "对照标签：打开 org 切换器" }, real))
      .toThrow(/selectOrganization/);
    expect(() => prepareReuseMiss({ ...base, intentId: "c1-read-tracking", intent: "读取 tracking 状态" }, real))
      .toThrow(/readGoogleTrackingReadiness/);
  });
});
