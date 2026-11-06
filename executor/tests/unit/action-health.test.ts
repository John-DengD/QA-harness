import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ActionEntry } from "../../src/tools/action-index";
import {
  actionCodeHash,
  applyHealthOutcome,
  emptyActionHealth,
  healthNotice,
  readActionHealth,
  resolveQaRoot,
  updateActionHealth,
  type ActionHealthStamp,
} from "../../src/tools/action-health";
import { selectActions } from "../../src/tools/action-select";
import { annotateCandidatesWithHealth } from "../../src/tools/action-health";
import { prepareReuseMiss } from "../../src/tools/reuse-miss";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "action-health-"));
  roots.push(root);
  return root;
}

const stamp = (overrides: Partial<ActionHealthStamp> = {}): ActionHealthStamp => ({
  at: "2026-10-14T08:28:28.525Z", runId: "r-1", environment: "app-staging.hellyeahai.com",
  productSha: null, codeHash: "aaaaaaaaaaaa", ...overrides,
});
const driftFailure = { category: "locator_not_found" as const, locator: "getByRole('heading')", evidenceRef: "PR-1/runs/r-1/evidence/C1/playwright/actions/x-failure.json" };

describe("action health transitions", () => {
  it("marks a drift failure suspected and counts consecutive ones", () => {
    let file = applyHealthOutcome(emptyActionHealth(), { action: "openStudioLibrary", kind: "drift", stamp: stamp(), failure: driftFailure });
    expect(file.actions.openStudioLibrary).toMatchObject({
      status: "suspected_drift", consecutiveFailures: 1, lastVerified: null,
      lastFailure: { runId: "r-1", category: "locator_not_found", evidenceRef: driftFailure.evidenceRef },
    });
    file = applyHealthOutcome(file, { action: "openStudioLibrary", kind: "drift", stamp: stamp({ runId: "r-2" }), failure: driftFailure });
    expect(file.actions.openStudioLibrary.consecutiveFailures).toBe(2);
    expect(file.actions.openStudioLibrary.lastFailure?.runId).toBe("r-2");
  });

  it("a completed run records lastVerified and clears the count and status", () => {
    let file = applyHealthOutcome(emptyActionHealth(), { action: "openStudioLibrary", kind: "drift", stamp: stamp(), failure: driftFailure });
    file = applyHealthOutcome(file, { action: "openStudioLibrary", kind: "completed",
      stamp: stamp({ runId: "r-3", productSha: "4daa5597e29c", codeHash: "bbbbbbbbbbbb" }) });
    expect(file.actions.openStudioLibrary).toMatchObject({
      status: "healthy", consecutiveFailures: 0,
      lastVerified: { runId: "r-3", productSha: "4daa5597e29c", environment: "app-staging.hellyeahai.com", codeHash: "bbbbbbbbbbbb" },
    });
    // The last failure stays for history.
    expect(file.actions.openStudioLibrary.lastFailure?.runId).toBe("r-1");
  });

  it("does not change health for failures that are not drift", () => {
    const file = applyHealthOutcome(emptyActionHealth(), { action: "x", kind: "completed", stamp: stamp() });
    const after = applyHealthOutcome(file, { action: "x", kind: "other_failure", stamp: stamp({ runId: "r-9" }) });
    expect(after).toEqual(file);
  });

  it("notices a suspected Action, and a code change since the failure", () => {
    const file = applyHealthOutcome(emptyActionHealth(), { action: "openStudioLibrary", kind: "drift", stamp: stamp(), failure: driftFailure });
    const same = healthNotice("openStudioLibrary", file.actions.openStudioLibrary, "aaaaaaaaaaaa");
    expect(same.status).toBe("suspected_drift");
    expect(same.notice).toContain("可能已失效");
    expect(same.notice).toContain("先修或直接用 Computer Use");
    expect(same.notice).toContain("--miss-reason drift --miss-action openStudioLibrary");
    const changed = healthNotice("openStudioLibrary", file.actions.openStudioLibrary, "cccccccccccc");
    expect(changed.status).toBe("suspected_drift");
    expect(changed.codeChangedSinceFailure).toBe(true);
    expect(changed.notice).toContain("pnpm action:drift verify openStudioLibrary");
    expect(healthNotice("x", undefined, "a")).toEqual({ status: "unknown", notice: null, codeChangedSinceFailure: false });
    const healthy = applyHealthOutcome(file, { action: "openStudioLibrary", kind: "completed", stamp: stamp() });
    expect(healthNotice("openStudioLibrary", healthy.actions.openStudioLibrary, "aaaaaaaaaaaa").notice).toBeNull();
  });
});

describe("action health storage under QA_ROOT/.qa-loop", () => {
  it("writes, reads back and survives concurrent updates", async () => {
    const root = await tempRoot();
    await Promise.all(Array.from({ length: 6 }, (_, index) => updateActionHealth(root, {
      action: `a${index}`, kind: "drift", stamp: stamp(), failure: driftFailure,
    })));
    const file = await readActionHealth(root);
    expect(Object.keys(file.actions).sort()).toEqual(["a0", "a1", "a2", "a3", "a4", "a5"]);
    const raw = JSON.parse(await readFile(path.join(root, ".qa-loop", "action-health.json"), "utf8"));
    expect(raw.schemaVersion).toBe(1);
  });

  it("reads an absent file as empty", async () => {
    expect(await readActionHealth(await tempRoot())).toEqual(emptyActionHealth());
  });

  it("finds QA_ROOT: explicit, nearest .qa-loop ancestor, else three above the run", async () => {
    const root = await tempRoot();
    const runRoot = path.join(root, "Hellyeah", "UD", "PR-1", "runs", "r-1");
    await mkdir(runRoot, { recursive: true });
    expect(resolveQaRoot(runRoot, "/explicit")).toBe("/explicit");
    expect(resolveQaRoot(runRoot)).toBe(path.join(root, "Hellyeah", "UD"));
    await mkdir(path.join(root, "Hellyeah", ".qa-loop"), { recursive: true });
    expect(resolveQaRoot(runRoot)).toBe(path.join(root, "Hellyeah"));
    expect(resolveQaRoot(path.join(root, "loose"))).toBeNull();
  });

  it("hashes the Action source file so a fix is visible", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "one");
    const first = actionCodeHash(root, "src/a.ts");
    await writeFile(path.join(root, "src", "a.ts"), "two");
    expect(actionCodeHash(root, "src/a.ts")).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("selection and miss checks warn about a suspected Action without blocking it", () => {
  const entries: ActionEntry[] = [
    { name: "openStudioLibrary", domain: "studio", file: "src/actions/studio-actions.ts", line: 1, signature: "", hot: true },
    { name: "openCampaignList", domain: "campaign", file: "src/actions/campaign-actions.ts", line: 1, signature: "", hot: true },
  ];
  const catalog = {
    openStudioLibrary: { intent: "打开 Studio 素材库", aliases: ["open Studio library"], rollback: "read" as const },
    openCampaignList: { intent: "打开 Campaigns 页", rollback: "read" as const },
  };
  const health = applyHealthOutcome(emptyActionHealth(), { action: "openStudioLibrary", kind: "drift", stamp: stamp(), failure: driftFailure });
  const hashes = { "src/actions/studio-actions.ts": "aaaaaaaaaaaa", "src/actions/campaign-actions.ts": "dddddddddddd" };

  it("action:select keeps the suspected Action eligible and attaches the notice", () => {
    const matches = annotateCandidatesWithHealth(selectActions(entries, catalog, { intent: "打开 Studio 素材库" }), health, hashes);
    expect(matches).toHaveLength(1);
    expect(matches[0].eligible).toBe(true);
    expect(matches[0].health.status).toBe("suspected_drift");
    expect(matches[0].health.notice).toContain("可能已失效，先修或直接用 Computer Use");
    const other = annotateCandidatesWithHealth(selectActions(entries, catalog, { intent: "打开 Campaigns 页" }), health, hashes);
    expect(other[0].health).toEqual({ status: "unknown", notice: null, codeChangedSinceFailure: false });
  });

  it("the absent check lists the suspected candidate with the drift hint", () => {
    expect(() => prepareReuseMiss({
      runId: "r", caseId: "C1", intentId: "open-studio", intent: "打开 Studio 素材库",
      source: "computer-use", executionMs: 1,
    }, { entries, catalog, priorEvents: [], health: { status: health, codeHashes: hashes } }))
      .toThrow(/openStudioLibrary \(runnable, suspected_drift\).*可能已失效，先修或直接用 Computer Use/);
  });

  it("a drift miss naming a suspected Action is accepted", () => {
    const event = prepareReuseMiss({
      runId: "r", caseId: "C1", intentId: "open-studio", intent: "打开 Studio 素材库",
      source: "computer-use", reason: "drift", action: "openStudioLibrary", executionMs: 1,
    }, { entries, catalog, priorEvents: [], health: { status: health, codeHashes: hashes } });
    expect(event).toMatchObject({ reason: "drift", action: "openStudioLibrary" });
  });
});

describe("action health firstSeen / lastUsed", () => {
  it("sets firstSeen on the first record and lastUsed on every trusted success, keeping both across drift", () => {
    let file = applyHealthOutcome(emptyActionHealth(), { action: "openStudioLibrary", kind: "drift",
      stamp: stamp({ at: "2026-10-01T00:00:00.000Z" }), failure: driftFailure });
    expect(file.actions.openStudioLibrary.firstSeen).toBe("2026-10-01T00:00:00.000Z");
    expect(file.actions.openStudioLibrary.lastUsed ?? null).toBeNull();
    file = applyHealthOutcome(file, { action: "openStudioLibrary", kind: "completed", stamp: stamp({ at: "2026-10-05T00:00:00.000Z" }) });
    expect(file.actions.openStudioLibrary).toMatchObject({ firstSeen: "2026-10-01T00:00:00.000Z", lastUsed: "2026-10-05T00:00:00.000Z" });
    file = applyHealthOutcome(file, { action: "openStudioLibrary", kind: "drift", stamp: stamp({ at: "2026-10-09T00:00:00.000Z" }), failure: driftFailure });
    expect(file.actions.openStudioLibrary).toMatchObject({ firstSeen: "2026-10-01T00:00:00.000Z", lastUsed: "2026-10-05T00:00:00.000Z",
      status: "suspected_drift" });
  });

  it("reads older records without firstSeen/lastUsed and keeps them unchanged until updated", () => {
    const legacy = { schemaVersion: 1 as const, actions: { readCard: { status: "healthy" as const, consecutiveFailures: 0,
      lastVerified: stamp({ at: "2026-09-01T00:00:00.000Z" }), lastFailure: null } } };
    const next = applyHealthOutcome(legacy, { action: "readCard", kind: "completed", stamp: stamp({ at: "2026-10-02T00:00:00.000Z" }) });
    // A legacy record's first sighting is the earliest stamp it carries.
    expect(next.actions.readCard).toMatchObject({ firstSeen: "2026-09-01T00:00:00.000Z", lastUsed: "2026-10-02T00:00:00.000Z" });
  });

  it("stampFirstSeen adds healthy records for catalog Actions without one and leaves existing records alone", async () => {
    const { stampFirstSeen } = await import("../../src/tools/action-health");
    const root = await tempRoot();
    await updateActionHealth(root, { action: "existing", kind: "drift", stamp: stamp(), failure: driftFailure });
    const before = (await readActionHealth(root)).actions.existing;
    const stamped = await stampFirstSeen(root, ["existing", "fresh"], new Date("2026-10-16T00:00:00.000Z"));
    expect(stamped).toEqual(["fresh"]);
    const after = await readActionHealth(root);
    expect(after.actions.existing).toEqual(before);
    expect(after.actions.fresh).toEqual({ status: "healthy", consecutiveFailures: 0, lastVerified: null, lastFailure: null,
      firstSeen: "2026-10-16T00:00:00.000Z" });
    expect(await stampFirstSeen(root, ["existing", "fresh"], new Date("2026-11-30T00:00:00.000Z"))).toEqual([]);
    expect((await readActionHealth(root)).actions.fresh.firstSeen).toBe("2026-10-16T00:00:00.000Z");
  });
});
