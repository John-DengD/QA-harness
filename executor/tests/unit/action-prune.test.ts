import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readActionHealth } from "../../src/tools/action-health";
import { applyPrune, planPrune } from "../../src/tools/action-prune";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const now = new Date("2026-10-16T00:00:00.000Z");
const day = (iso: string) => `${iso}T00:00:00.000Z`;

const actionsSource = `import type { Page } from "@playwright/test";
import { helperA, helperB } from "../lib/helpers";

/** Opens the stale panel. */
export async function openStalePanel(page: Page): Promise<void> {
  await helperA(page);
}

export async function keepUsed(page: Page): Promise<void> {
  await helperB(page);
}

export async function referencedOne(page: Page): Promise<void> {
  await helperB(page);
}

export async function unhealthyOne(page: Page): Promise<void> {
  await helperB(page);
}

export async function driftFollowupOld(page: Page): Promise<void> {
  await helperB(page);
}

export async function driftFollowupNew(page: Page): Promise<void> {
  await helperB(page);
}

export async function pinnedOne(page: Page): Promise<void> {
  await helperB(page);
}

export async function recentOne(page: Page): Promise<void> {
  await helperB(page);
}

export async function staleUndo(page: Page): Promise<void> {
  await helperB(page);
}

export async function doWithUndo(page: Page): Promise<void> {
  await helperB(page);
}

export async function unusedNew(page: Page): Promise<void> {
  await helperB(page);
}
`;

const catalog = {
  openStalePanel: { intent: "打开过期面板", rollback: "read" },
  keepUsed: { intent: "被多个测试用", rollback: "read" },
  referencedOne: { intent: "被脚本引用", rollback: "read" },
  unhealthyOne: { intent: "连续失败", rollback: "read" },
  driftFollowupOld: { intent: "漂移跟进超过两周", rollback: "read" },
  driftFollowupNew: { intent: "漂移跟进不到两周", rollback: "read" },
  pinnedOne: { intent: "钉住的", rollback: "read", pinned: true },
  recentOne: { intent: "最近用过", rollback: "read" },
  staleUndo: { intent: "撤回", rollback: "reversible", undoneBy: "doWithUndo" },
  doWithUndo: { intent: "可撤回操作", rollback: "reversible", undoneBy: "staleUndo" },
  unusedNew: { intent: "新加的", rollback: "read" },
};

const record = (extra: Record<string, unknown>) => ({ status: "healthy", consecutiveFailures: 0, lastVerified: null, lastFailure: null, ...extra });
const failure = (at: string) => ({ at, runId: "r-1", environment: "app", productSha: null, codeHash: "aaaaaaaaaaaa",
  category: "locator_not_found", locator: null, evidenceRef: null });

async function workspace() {
  const skillRoot = await mkdtemp(path.join(os.tmpdir(), "prune-skill-"));
  const qaRoot = await mkdtemp(path.join(os.tmpdir(), "prune-qa-"));
  roots.push(skillRoot, qaRoot);
  await mkdir(path.join(skillRoot, "src/actions"), { recursive: true });
  await mkdir(path.join(skillRoot, "src/tools"), { recursive: true });
  await mkdir(path.join(skillRoot, "src/lib"), { recursive: true });
  await mkdir(path.join(skillRoot, "tests/unit"), { recursive: true });
  await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
  await writeFile(path.join(skillRoot, "src/actions/demo-actions.ts"), actionsSource);
  await writeFile(path.join(skillRoot, "src/lib/helpers.ts"), "export async function helperA(_: unknown) {}\nexport async function helperB(_: unknown) {}\n");
  await writeFile(path.join(skillRoot, "src/tools/action-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  // A dedicated test: imports and names only openStalePanel.
  await writeFile(path.join(skillRoot, "tests/unit/open-stale-panel.test.ts"),
    `import { it } from "vitest";\nimport { openStalePanel } from "../../src/actions/demo-actions";\nit("is a function", () => { void openStalePanel; });\n`);
  // A shared test: names two Actions, so it protects both.
  await writeFile(path.join(skillRoot, "tests/unit/demo.test.ts"),
    `import { it } from "vitest";\nimport { keepUsed, recentOne } from "../../src/actions/demo-actions";\nit("x", () => { void keepUsed; void recentOne; });\n`);
  await writeFile(path.join(skillRoot, "scripts/use.ts"), `// calls referencedOne from a script\nexport const name = "referencedOne";\n`);
  const old = { firstSeen: day("2026-08-01"), lastUsed: day("2026-08-10") };
  await mkdir(path.join(qaRoot, ".qa-loop/followups"), { recursive: true });
  await writeFile(path.join(qaRoot, ".qa-loop/action-health.json"), JSON.stringify({ schemaVersion: 1, actions: {
    openStalePanel: record(old),
    keepUsed: record(old),
    referencedOne: record(old),
    unhealthyOne: record({ status: "suspected_drift", consecutiveFailures: 3, firstSeen: day("2026-10-01"),
      lastUsed: day("2026-10-02"), lastFailure: failure(day("2026-10-12")) }),
    driftFollowupOld: record({ status: "suspected_drift", consecutiveFailures: 1, firstSeen: day("2026-10-01"), lastUsed: day("2026-10-01") }),
    driftFollowupNew: record({ status: "suspected_drift", consecutiveFailures: 1, firstSeen: day("2026-10-01"), lastUsed: day("2026-10-01") }),
    pinnedOne: record(old),
    recentOne: record({ firstSeen: day("2026-08-01"), lastUsed: day("2026-10-01") }),
    staleUndo: record(old),
    doWithUndo: record({ firstSeen: day("2026-08-01"), lastUsed: day("2026-10-10") }),
  } }));
  const followup = (action: string, createdAt: string) => ({ schemaVersion: 1, gapId: `script-drift-${action}-r-1`, journeyKey: "j",
    mechanismKey: `script-drift.${action}`, kind: "script_drift", source: { runId: "r-1", caseId: "case-1", ref: "x" },
    prerequisites: [], nextTrigger: "action-drift-verify", status: "open", createdAt, updatedAt: createdAt });
  await writeFile(path.join(qaRoot, ".qa-loop/followups/a.json"), JSON.stringify(followup("driftFollowupOld", day("2026-09-20"))));
  await writeFile(path.join(qaRoot, ".qa-loop/followups/b.json"), JSON.stringify(followup("driftFollowupNew", day("2026-10-10"))));
  return { skillRoot, qaRoot };
}

describe("planPrune", () => {
  it("stamps firstSeen for catalog Actions without health and never deletes them on day one", async () => {
    const { skillRoot, qaRoot } = await workspace();
    const plan = await planPrune({ skillRoot, qaRoot, now });
    expect(plan.stamped).toEqual(["unusedNew"]);
    expect((await readActionHealth(qaRoot)).actions.unusedNew).toMatchObject({ firstSeen: now.toISOString(), status: "healthy" });
    const named = [...plan.deletions, ...plan.protected].map((item) => item.action);
    expect(named).not.toContain("unusedNew");
    // 31 days later with no use, it becomes stale.
    const later = await planPrune({ skillRoot, qaRoot, now: new Date("2026-11-17T00:00:00.000Z") });
    expect(later.deletions.map((item) => item.action)).toContain("unusedNew");
  });

  it("selects unhealthy (3 failures, or a script_drift followup open > 14 days) and stale (> 30 days) Actions", async () => {
    const { skillRoot, qaRoot } = await workspace();
    const plan = await planPrune({ skillRoot, qaRoot, now });
    const deletions = Object.fromEntries(plan.deletions.map((item) => [item.action, item]));
    expect(Object.keys(deletions).sort()).toEqual(["driftFollowupOld", "openStalePanel", "unhealthyOne"]);
    expect(deletions.openStalePanel).toMatchObject({ reason: "stale", since: day("2026-08-10"), file: "src/actions/demo-actions.ts",
      dedicatedTests: ["tests/unit/open-stale-panel.test.ts"] });
    expect(deletions.unhealthyOne).toMatchObject({ reason: "unhealthy", since: day("2026-10-12") });
    expect(deletions.driftFollowupOld).toMatchObject({ reason: "unhealthy", since: day("2026-09-20") });
    const all = [...plan.deletions, ...plan.protected].map((item) => item.action);
    for (const name of ["driftFollowupNew", "recentOne", "doWithUndo"]) expect(all, name).not.toContain(name);
  });

  it("protects Actions referenced elsewhere, pinned rows and Actions another row undoes with", async () => {
    const { skillRoot, qaRoot } = await workspace();
    const plan = await planPrune({ skillRoot, qaRoot, now });
    const protectedBy = Object.fromEntries(plan.protected.map((item) => [item.action, item]));
    expect(protectedBy.keepUsed).toMatchObject({ status: "stale_protected", reason: "referenced" });
    expect(protectedBy.keepUsed.references).toContain("tests/unit/demo.test.ts");
    expect(protectedBy.referencedOne).toMatchObject({ status: "stale_protected", reason: "referenced", references: ["scripts/use.ts"] });
    expect(protectedBy.pinnedOne).toMatchObject({ status: "stale_protected", reason: "pinned" });
    expect(protectedBy.staleUndo).toMatchObject({ status: "stale_protected", reason: "undone_by:doWithUndo" });
  });

  it("does not delete anything without apply", async () => {
    const { skillRoot, qaRoot } = await workspace();
    await planPrune({ skillRoot, qaRoot, now });
    expect(await readFile(path.join(skillRoot, "src/actions/demo-actions.ts"), "utf8")).toBe(actionsSource);
  });
});

describe("applyPrune", () => {
  it("removes the declaration with its JSDoc, the catalog row, the health record and the dedicated test, and archives it", async () => {
    const { skillRoot, qaRoot } = await workspace();
    const plan = await planPrune({ skillRoot, qaRoot, now });
    const only = { ...plan, deletions: plan.deletions.filter((item) => item.action === "openStalePanel") };
    const checks: string[] = [];
    const result = await applyPrune({ skillRoot, qaRoot, plan: only, now,
      runChecks: async (root) => { checks.push(root); return { ok: true, output: "" }; } });
    expect(checks).toEqual([skillRoot]);
    expect(result.deleted.map((item) => item.action)).toEqual(["openStalePanel"]);

    const source = await readFile(path.join(skillRoot, "src/actions/demo-actions.ts"), "utf8");
    expect(source).not.toContain("openStalePanel");
    expect(source).not.toContain("Opens the stale panel");
    expect(source).not.toMatch(/\n\n\n/);
    // helperA was only used by the removed Action; helperB stays.
    expect(source).toContain('import { helperB } from "../lib/helpers";');
    expect(source).toContain("export async function keepUsed(page: Page)");

    const table = JSON.parse(await readFile(path.join(skillRoot, "src/tools/action-catalog.json"), "utf8"));
    expect(table).not.toHaveProperty("openStalePanel");
    expect(Object.keys(table)).toHaveLength(Object.keys(catalog).length - 1);
    expect(existsSync(path.join(skillRoot, "tests/unit/open-stale-panel.test.ts"))).toBe(false);
    expect((await readActionHealth(qaRoot)).actions).not.toHaveProperty("openStalePanel");

    const archive = (await readFile(path.join(qaRoot, ".qa-loop/action-prune.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatchObject({ at: now.toISOString(), action: "openStalePanel", file: "src/actions/demo-actions.ts",
      reason: "stale", since: day("2026-08-10"), catalogRow: catalog.openStalePanel });
    expect(archive[0].codeHash).toMatch(/^[a-f0-9]{12}$/);
    expect(archive[0].removedSource).toBe("/** Opens the stale panel. */\nexport async function openStalePanel(page: Page): Promise<void> {\n  await helperA(page);\n}");
    expect(archive[0].removedTests).toEqual([{ file: "tests/unit/open-stale-panel.test.ts",
      content: expect.stringContaining("openStalePanel") }]);
  });

  it("removes several Actions from one file in one pass", async () => {
    const { skillRoot, qaRoot } = await workspace();
    const plan = await planPrune({ skillRoot, qaRoot, now });
    const result = await applyPrune({ skillRoot, qaRoot, plan, now, runChecks: async () => ({ ok: true, output: "" }) });
    expect(result.deleted.map((item) => item.action).sort()).toEqual(["driftFollowupOld", "openStalePanel", "unhealthyOne"]);
    const source = await readFile(path.join(skillRoot, "src/actions/demo-actions.ts"), "utf8");
    for (const name of ["driftFollowupOld", "openStalePanel", "unhealthyOne"]) expect(source).not.toContain(name);
    expect(source).toContain("driftFollowupNew");
  });

  it("restores every touched file and protects the Actions when typecheck or tests fail", async () => {
    const { skillRoot, qaRoot } = await workspace();
    const plan = await planPrune({ skillRoot, qaRoot, now });
    const catalogBefore = await readFile(path.join(skillRoot, "src/tools/action-catalog.json"), "utf8");
    const healthBefore = await readFile(path.join(qaRoot, ".qa-loop/action-health.json"), "utf8");
    const result = await applyPrune({ skillRoot, qaRoot, plan, now, runChecks: async () => ({ ok: false, output: "tsc failed" }) });
    expect(result.deleted).toEqual([]);
    expect(result.protected.filter((item) => item.reason === "build_or_tests_fail").map((item) => item.action).sort())
      .toEqual(["driftFollowupOld", "openStalePanel", "unhealthyOne"]);
    expect(await readFile(path.join(skillRoot, "src/actions/demo-actions.ts"), "utf8")).toBe(actionsSource);
    expect(await readFile(path.join(skillRoot, "src/tools/action-catalog.json"), "utf8")).toBe(catalogBefore);
    expect(existsSync(path.join(skillRoot, "tests/unit/open-stale-panel.test.ts"))).toBe(true);
    expect(await readFile(path.join(qaRoot, ".qa-loop/action-health.json"), "utf8")).toBe(healthBefore);
    expect(existsSync(path.join(qaRoot, ".qa-loop/action-prune.jsonl"))).toBe(false);
  });
});
