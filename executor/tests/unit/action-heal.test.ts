import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkRunHeal, evaluateHeal, planHeal, validateHealOutcomes, type HealOutcome } from "../../src/tools/action-heal";
import type { ReuseEvent } from "../../src/tools/action-index";

const runId = "r-20261015-1415";
const miss = (intentId: string, intent: string, reason: ReuseEvent["reason"], extra: Partial<ReuseEvent> = {}): ReuseEvent => ({
  runId, caseId: extra.caseId ?? "case-3", intentId, intent, outcome: "miss", source: "computer-use", reason,
  lookupMs: 0, executionMs: 2000, ...extra,
});

// The misses PR-1327 r-20261015-1415 actually logged.
const realMisses: ReuseEvent[] = [
  miss("c3-open-draft-as-traffic-dialog", "打开 PMax 的 Draft as Traffic 确认弹窗", "drift", { action: "openSwitchToTrafficDialog" }),
  miss("c3-rename-draft-runid", "给 agent 新起草的草稿名加上本轮 runId 以便识别", "absent"),
  miss("c4-get-more-sales", "点击快捷目标 Get more sales 让 agent 起草", "precondition", { caseId: "case-4", action: "submitCampaignGoal" }),
  miss("c4-rename-draft-runid", "给新草稿名加上本轮 runId：展开 Details", "absent", { caseId: "case-4" }),
  miss("c5-rename-draft-runid", "给新草稿名加上本轮 runId：展开 Details", "absent", { caseId: "case-5" }),
];

describe("evaluateHeal: every miss needs a valid handling outcome", () => {
  it("lists every miss as unresolved when no outcome was written", () => {
    const result = evaluateHeal(realMisses, []);
    expect(result.ok).toBe(false);
    expect(result.unresolved.map((item) => item.intentId)).toEqual(realMisses.map((item) => item.intentId));
    expect(result.unresolved[0]).toMatchObject({ reason: "drift", problem: "no outcome", allowed: ["repaired", "gap", "deferred"] });
  });

  it("accepts the allowed outcomes per reason, keyed by intentId or by intent text", () => {
    const outcomes: HealOutcome[] = [
      { intentId: "c3-open-draft-as-traffic-dialog", reason: "drift", outcome: "repaired", actionName: "openSwitchToTrafficDialog" },
      { intent: "给新草稿名加上本轮 runId：展开 Details", reason: "absent", outcome: "new_candidate", actionName: "renameCampaignDraft" },
      { intentId: "c3-rename-draft-runid", reason: "absent", outcome: "gap", gapId: "action-miss-rename" },
      { intentId: "c4-get-more-sales", reason: "precondition", outcome: "extended", actionName: "submitCampaignGoal" },
    ];
    const result = evaluateHeal(realMisses, outcomes);
    expect(result.unresolved).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.resolved).toHaveLength(5);
  });

  it("rejects an outcome the reason does not allow, a deferral without a reason and an Action outcome without its Action", () => {
    const result = evaluateHeal(realMisses.slice(0, 3), [
      { intentId: "c3-open-draft-as-traffic-dialog", reason: "drift", outcome: "new_candidate", actionName: "x" },
      { intentId: "c3-rename-draft-runid", reason: "absent", outcome: "deferred", deferReason: "  " },
      { intentId: "c4-get-more-sales", reason: "precondition", outcome: "extended" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.unresolved.map((item) => [item.intentId, item.problem])).toEqual([
      ["c3-open-draft-as-traffic-dialog", expect.stringMatching(/new_candidate.*drift/)],
      ["c3-rename-draft-runid", expect.stringMatching(/deferReason/)],
      ["c4-get-more-sales", expect.stringMatching(/actionName/)],
    ]);
  });

  it("allows not_repairable only for denied and unsafe misses, and a deferral with a reason anywhere", () => {
    const denied = miss("c9-approve", "管理员批准 Campaign 上线", "denied", { action: "approveAdminCampaignOnce" });
    const unsafe = miss("c9-delete", "删除组织", "unsafe");
    expect(evaluateHeal([denied, unsafe], [
      { intentId: "c9-approve", reason: "denied", outcome: "not_repairable" },
      { intentId: "c9-delete", reason: "unsafe", outcome: "not_repairable" },
    ]).ok).toBe(true);
    expect(evaluateHeal([realMisses[1]], [{ intentId: "c3-rename-draft-runid", reason: "absent", outcome: "not_repairable" }]).ok).toBe(false);
    expect(evaluateHeal([realMisses[0]], [{ intentId: "c3-open-draft-as-traffic-dialog", reason: "drift", outcome: "deferred",
      deferReason: "产品文案还在改，下轮修" }]).ok).toBe(true);
  });

  it("an outcome for another reason does not resolve the miss", () => {
    const result = evaluateHeal([realMisses[1]], [{ intentId: "c3-rename-draft-runid", reason: "drift", outcome: "gap" }]);
    expect(result.ok).toBe(false);
  });
});

describe("validateHealOutcomes", () => {
  it("rejects a non-array, an unknown outcome and an entry with neither intentId nor intent", () => {
    expect(() => validateHealOutcomes({})).toThrow(/array/);
    expect(() => validateHealOutcomes([{ intentId: "a", reason: "absent", outcome: "fixed" }])).toThrow(/outcome/);
    expect(() => validateHealOutcomes([{ reason: "absent", outcome: "gap" }])).toThrow(/intentId or intent/);
    expect(validateHealOutcomes([{ intent: "x", reason: "absent", outcome: "gap" }])).toHaveLength(1);
  });
});

describe("planHeal", () => {
  it("groups identical intents and says what each kind of miss needs", () => {
    const plan = planHeal(realMisses, { runRoot: "/runs/r-1", catalog: { submitCampaignGoal: { intent: "提交目标", rollback: "irreversible" } } });
    const drift = plan.find((item) => item.reason === "drift")!;
    expect(drift.handling).toBe("repair_action");
    expect(drift.allowed).toEqual(["repaired", "gap", "deferred"]);
    expect(drift.commands.join("\n")).toContain("pnpm action:drift list --run-root /runs/r-1");
    expect(drift.commands.join("\n")).toContain("pnpm action:drift verify openSwitchToTrafficDialog");

    const rename = plan.find((item) => item.intent === "给新草稿名加上本轮 runId：展开 Details")!;
    expect(rename).toMatchObject({ reason: "absent", count: 2, handling: "add_minimal_action_now" });
    expect(rename.intentIds).toEqual(["c4-rename-draft-runid", "c5-rename-draft-runid"]);
    expect(rename.flags).toContain("seen_2_or_more");

    const once = plan.find((item) => item.intent === "给 agent 新起草的草稿名加上本轮 runId 以便识别")!;
    expect(once).toMatchObject({ count: 1, handling: "new_candidate_or_gap" });

    const precondition = plan.find((item) => item.reason === "precondition")!;
    expect(precondition).toMatchObject({ handling: "extend_existing_action", action: "submitCampaignGoal" });
    expect(precondition.summary).toContain("submitCampaignGoal");
  });

  it("flags a one-off absent intent that is irreversible or costly as add-now", () => {
    const plan = planHeal([miss("c8-cancel", "用户取消 Campaign 并确认", "absent")], { runRoot: "/r", catalog: {} });
    expect(plan[0]).toMatchObject({ handling: "add_minimal_action_now" });
    expect(plan[0].flags).toContain("irreversible_or_high_cost");
  });
});

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("checkRunHeal reads the run's reuse log and action-heal.json", () => {
  it("ignores hits and not_reusable intents and reads outcomes from run-state/action-heal.json", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "action-heal-"));
    roots.push(runRoot);
    await mkdir(path.join(runRoot, "run-state"));
    const lines = [
      { kind: "preflight", runId, createdAt: "2026-10-15T06:16:15.351Z", indexedActions: 32, hotCandidates: [] },
      { runId, caseId: "case-1", intentId: "c1-skip", intent: "看一眼", outcome: "not_reusable", source: "none",
        notReusableReason: "one_off", lookupMs: 0, executionMs: 1 },
      realMisses[1],
    ];
    await writeFile(path.join(runRoot, "run-state", "action-reuse.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    let result = await checkRunHeal(runRoot);
    expect(result.ok).toBe(false);
    expect(result.total).toBe(1);
    await writeFile(path.join(runRoot, "run-state", "action-heal.json"),
      JSON.stringify([{ intentId: "c3-rename-draft-runid", reason: "absent", outcome: "gap", gapId: "g-1" }]));
    result = await checkRunHeal(runRoot);
    expect(result).toMatchObject({ ok: true, total: 1, unresolved: [] });
  });
});
