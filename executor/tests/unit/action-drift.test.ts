import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { initRun, inspectFollowup, listFollowups } from "../../src/loop/state";
import { concludeDriftVerify, collectRunDriftFailures, collectRunReportedDrift, listDrift, recordReportedDrift, reportDriftForEvent } from "../../src/tools/action-drift";
import { updateActionHealth } from "../../src/tools/action-health";
import type { ActionEntry } from "../../src/tools/action-index";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const runId = "r-20261014-drift";
const runRel = `PR-1217/runs/${runId}`;
const entries: ActionEntry[] = [
  { name: "openStudioLibrary", domain: "studio", file: "src/actions/studio-actions.ts", line: 140, signature: "", hot: true },
  { name: "returnToStudioLibrary", domain: "studio", file: "src/actions/studio-actions.ts", line: 280, signature: "", hot: false },
];
const failureError = "expect(locator).toBeVisible() failed\n\nLocator: getByRole('heading', { name: /^(?:Studio|Ad Library)$/ })\nTimeout: 45000ms\nError: element(s) not found\n";

async function workspace(register = true): Promise<{ root: string; runRoot: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "action-drift-"));
  roots.push(root);
  const runRoot = path.join(root, runRel);
  await mkdir(path.join(runRoot, "run-state"), { recursive: true });
  await writeFile(path.join(runRoot, "run-state", "goal-test-model.md"), "# drift loop\n");
  if (register) {
    await initRun(root, {
      runId, runRoot: runRel, journeyKey: "studio-library", mode: "regression",
      scope: { feature: "PR-1217", environment: "staging", role: "customer", orgAlias: "qa-secondary", deploymentSha: "4daa5597e29c" },
      executorId: "agent-1",
    }, { taskModel: `${runRel}/run-state/goal-test-model.md` });
  }
  const actions = path.join(runRoot, "evidence", "C1", "playwright", "actions");
  await mkdir(actions, { recursive: true });
  const id = "11111111-1111-4111-8111-111111111111";
  await writeFile(path.join(actions, `${id}.json`), JSON.stringify({
    kind: "action-invocation", schemaVersion: 2, invocationId: id, runId, caseId: "C1", intentId: "open-studio",
    action: "openStudioLibrary", status: "failed", finishedAt: "2026-10-14T09:00:00.000Z", error: failureError,
    driftSuspected: true,
    failure: { category: "locator_not_found", driftSuspected: true, locator: "getByRole('heading', { name: /^(?:Studio|Ad Library)$/ })", timeoutMs: 45000, timeoutKind: "expect" },
    failureSnapshot: `playwright/actions/${id}-failure.json`,
  }));
  await writeFile(path.join(actions, `${id}-failure.json`), JSON.stringify({ ariaSnapshot: "- heading \"Ads\"" }));
  // A failed but non-drift invocation is not listed.
  const other = "22222222-2222-4222-8222-222222222222";
  await writeFile(path.join(actions, `${other}.json`), JSON.stringify({
    kind: "action-invocation", invocationId: other, runId, caseId: "C1", action: "returnToStudioLibrary",
    status: "failed", driftSuspected: false, failure: { category: "network", driftSuspected: false },
  }));
  return { root, runRoot };
}

describe("action:drift list", () => {
  it("collects this run's drift-suspected invocations with their evidence", async () => {
    const { runRoot } = await workspace();
    const failures = await collectRunDriftFailures(runRoot);
    expect(failures).toEqual([expect.objectContaining({
      action: "openStudioLibrary", caseId: "C1", category: "locator_not_found", timeoutMs: 45000,
      factRef: "evidence/C1/playwright/actions/11111111-1111-4111-8111-111111111111.json",
      snapshotRef: "evidence/C1/playwright/actions/11111111-1111-4111-8111-111111111111-failure.json",
    })]);
  });

  it("joins run failures with suspected health and points at the source and product search", async () => {
    const { root, runRoot } = await workspace();
    await updateActionHealth(root, { action: "returnToStudioLibrary", kind: "drift",
      stamp: { at: "2026-10-13T00:00:00Z", runId: "older", environment: "app-staging.hellyeahai.com", productSha: null, codeHash: "x" },
      failure: { category: "locator_timeout", locator: "getByRole('button', { name: 'Ad Library', exact: true })", evidenceRef: null } });
    const listed = await listDrift({ qaRoot: root, runRoot, entries, codeHashes: {} , productRepo: "/repo" });
    expect(listed.map((item) => item.action)).toEqual(["openStudioLibrary", "returnToStudioLibrary"]);
    const studio = listed[0];
    expect(studio.source).toBe("src/actions/studio-actions.ts:140");
    expect(studio.runFailures).toHaveLength(1);
    expect(studio.searchTexts).toEqual(["Studio", "Ad Library"]);
    expect(studio.productSearch).toContain("git -C /repo log origin/staging");
    expect(studio.productSearch).toContain("-S'Ad Library'");
    expect(listed[1].health.status).toBe("suspected_drift");
    expect(listed[1].runFailures).toEqual([]);
  });
});

describe("drift reported by hand (Computer Use miss or a refuted cross-check)", () => {
  const preflight = { kind: "preflight", runId, createdAt: "2026-10-14T08:00:00.000Z", indexedActions: 3, hotCandidates: [] };
  const driftMiss = { runId, caseId: "case-3", intentId: "c3-open-traffic-dialog", intent: "打开切到 Traffic 的确认弹窗",
    outcome: "miss", source: "computer-use", reason: "drift", action: "openSwitchToTrafficDialog", lookupMs: 0, executionMs: 900 };
  const withTraffic = [...entries,
    { name: "openSwitchToTrafficDialog", domain: "google-tracking", file: "src/actions/google-tracking-actions.ts", line: 236, signature: "", hot: false }];

  it("lists a --miss-reason drift --miss-action X from this run's reuse log", async () => {
    const { root, runRoot } = await workspace();
    await writeFile(path.join(runRoot, "run-state", "action-reuse.jsonl"),
      [preflight, driftMiss].map((line) => JSON.stringify(line)).join("\n") + "\n");
    expect(await collectRunReportedDrift(runRoot)).toEqual([
      { action: "openSwitchToTrafficDialog", caseId: "case-3", intentId: "c3-open-traffic-dialog", source: "computer-use", via: "miss" },
    ]);
    const listed = await listDrift({ qaRoot: root, runRoot, entries: withTraffic, codeHashes: {}, productRepo: "/repo" });
    const traffic = listed.find((item) => item.action === "openSwitchToTrafficDialog")!;
    expect(traffic.source).toBe("src/actions/google-tracking-actions.ts:236");
    expect(traffic.reportedMisses).toHaveLength(1);
    expect(listed.find((item) => item.action === "openStudioLibrary")!.reportedMisses).toEqual([]);
  });

  it("marks the Action suspected_drift in health when the drift is reported", async () => {
    const { root } = await workspace();
    const record = await recordReportedDrift(root, { action: "openSwitchToTrafficDialog", runId, codeHash: "abc123abc123",
      environment: "pr-1327-sandbox", evidenceRef: `${runRel}/run-state/action-reuse.jsonl` });
    expect(record).toMatchObject({ status: "suspected_drift", consecutiveFailures: 1,
      lastFailure: { category: "reported_drift", runId, evidenceRef: `${runRel}/run-state/action-reuse.jsonl` } });
    const listed = await listDrift({ qaRoot: root, entries, codeHashes: {}, productRepo: "/repo" });
    expect(listed.map((item) => item.action)).toContain("openSwitchToTrafficDialog");
  });
  it("a cross-check confirmed as a hit marks a suspected Action healthy again", async () => {
    const { root, runRoot } = await workspace();
    await recordReportedDrift(root, { action: "openSwitchToTrafficDialog", runId, codeHash: "abc123abc123" });
    const confirmedHit = { runId, caseId: "case-3", intentId: "c3-read", outcome: "hit", source: "index",
      action: "openSwitchToTrafficDialog", crossCheck: { result: "hit" } };
    const result = await reportDriftForEvent({ event: confirmedHit, reuseLog: path.join(runRoot, "run-state", "action-reuse.jsonl"),
      entries: withTraffic, skillRoot: path.resolve(import.meta.dirname, "../.."), qaRoot: root });
    expect(result.healthError).toBeNull();
    expect(result.health).toMatchObject({ status: "healthy", consecutiveFailures: 0, lastVerified: { runId } });
    const listed = await listDrift({ qaRoot: root, entries: withTraffic, codeHashes: {}, productRepo: "/repo" });
    expect(listed.map((item) => item.action)).not.toContain("openSwitchToTrafficDialog");
  });

  it("a sentinel reading settled as drift is not counted twice (e2b:action already marked it)", async () => {
    const { SENTINEL_REASON_PREFIX } = await import("../../src/tools/silent-drift");
    const { root, runRoot } = await workspace();
    const first = await recordReportedDrift(root, { action: "openSwitchToTrafficDialog", runId, codeHash: "abc123abc123" });
    const refuted = { runId, caseId: "case-2", intentId: "c2-read", outcome: "miss", reason: "drift", source: "computer-use",
      action: "openSwitchToTrafficDialog",
      crossCheck: { result: "drift", reasons: [`${SENTINEL_REASON_PREFIX}cardState 读到 unrecognized`] } };
    const result = await reportDriftForEvent({ event: refuted, reuseLog: path.join(runRoot, "run-state", "action-reuse.jsonl"),
      entries: withTraffic, skillRoot: path.resolve(import.meta.dirname, "../.."), qaRoot: root });
    expect(result).toEqual({ health: null, healthError: null });
    expect(first?.consecutiveFailures).toBe(1);
  });
});

describe("action:drift verify conclusion", () => {
  it("a completed rerun is recorded as repaired and registers no gap", async () => {
    const { root, runRoot } = await workspace();
    const result = await concludeDriftVerify({
      qaRoot: root, runRoot, action: "openStudioLibrary", caseId: "C2",
      rerun: { status: "completed", invocationId: "33333333-3333-4333-8333-333333333333", factPath: path.join(runRoot, "evidence/C2/playwright/actions/x.json") },
    });
    expect(result).toMatchObject({ outcome: "repaired", gap: null });
    expect(await listFollowups(root)).toEqual([]);
    const log = (await readFile(path.join(runRoot, "run-state", "drift-repair.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(log).toEqual([expect.objectContaining({ action: "openStudioLibrary", outcome: "repaired",
      repair: "done", verifyRef: "evidence/C2/playwright/actions/x.json" })]);
  });

  it("a failed rerun registers a script_drift gap pointing at the frozen evidence", async () => {
    const { root, runRoot } = await workspace();
    const evidence = path.join(runRoot, "evidence/C1/playwright/actions/11111111-1111-4111-8111-111111111111-failure.json");
    const result = await concludeDriftVerify({
      qaRoot: root, runRoot, action: "openStudioLibrary", caseId: "C1",
      rerun: { status: "failed", invocationId: "44444444-4444-4444-8444-444444444444", factPath: evidence, failureSnapshot: evidence },
    });
    expect(result.outcome).toBe("gap_registered");
    const written = (await readFile(path.join(runRoot, "run-state", "drift-repair.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(written).toEqual([expect.objectContaining({
      action: "openStudioLibrary", repair: "failed", gapId: result.gap!.gapId,
      evidenceRef: "evidence/C1/playwright/actions/11111111-1111-4111-8111-111111111111-failure.json",
      blocker: expect.stringMatching(/verify rerun.*failed/),
    })]);
    const gap = await inspectFollowup(root, result.gap!.gapId);
    expect(gap).toMatchObject({
      kind: "script_drift", journeyKey: "studio-library", mechanismKey: "script-drift.openStudioLibrary",
      source: { runId, caseId: "C1", ref: `${runRel}/evidence/C1/playwright/actions/11111111-1111-4111-8111-111111111111-failure.json` },
      nextTrigger: "action-drift-verify", status: "open",
    });
  });

  it("without a registered run it returns the add-gap command instead of guessing", async () => {
    const { root, runRoot } = await workspace(false);
    const evidence = path.join(runRoot, "evidence/C1/playwright/actions/11111111-1111-4111-8111-111111111111-failure.json");
    const result = await concludeDriftVerify({
      qaRoot: root, runRoot, action: "openStudioLibrary", caseId: "C1",
      rerun: { status: "failed", invocationId: "44444444-4444-4444-8444-444444444444", factPath: evidence },
    });
    expect(result.outcome).toBe("gap_pending");
    expect(result.addGapCommand).toContain("pnpm loop:state -- add-gap");
    expect(result.addGapCommand).toContain("--kind script_drift");
    expect(result.addGapCommand).toContain("--mechanism-key script-drift.openStudioLibrary");
  });
});

describe("action:drift CLI", () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/action-drift.ts", ...args], {
    cwd: path.resolve(import.meta.dirname, "../.."), encoding: "utf8", timeout: 60_000,
  });

  it("lists suspected Actions as JSON", async () => {
    const { root, runRoot } = await workspace();
    const result = cli("list", "--qa-root", root, "--run-root", runRoot);
    expect(result.status, result.stderr).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.actions.map((item: { action: string }) => item.action)).toEqual(["openStudioLibrary"]);
    expect(out.actions[0].source).toMatch(/^src\/actions\/studio-actions\.ts:\d+$/);
    expect(out.nextSteps.join("\n")).toContain("pnpm action:drift verify");
  });

  it("refuses verify for an unknown Action or without a run context", () => {
    expect(cli("verify", "noSuchAction", "--qa-root", "/tmp").stderr).toMatch(/Usage|noSuchAction/);
    expect(cli("bogus").status).not.toBe(0);
  });
});
