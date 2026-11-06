import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertDriftRepairRecorded, validateDriftRepairRecords } from "../../src/loop/drift-gate";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const preflight = JSON.stringify({ kind: "preflight", runId: "run-1", createdAt: "2026-10-12T00:00:00Z", indexedActions: 3, hotCandidates: [] });
const miss = (reason: string, action?: string) => JSON.stringify({
  runId: "run-1", caseId: "case-3", intentId: `i-${reason}`, intent: "open dialog", outcome: "miss",
  source: "computer-use", reason, lookupMs: 1, executionMs: 1, ...(action ? { action } : {}),
});

async function runRoot(options: { drift?: "miss" | "invocation" | "none"; records?: object[] | string; files?: string[] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "drift-gate-"));
  roots.push(root);
  await mkdir(path.join(root, "run-state"), { recursive: true });
  const lines = [preflight, miss("novel")];
  if (options.drift === "miss") lines.push(miss("drift", "openSwitchToTrafficDialog"));
  await writeFile(path.join(root, "run-state", "action-reuse.jsonl"), `${lines.join("\n")}\n`);
  if (options.drift === "invocation") {
    const directory = path.join(root, "evidence", "case-3", "playwright", "actions");
    await mkdir(directory, { recursive: true });
    const invocationId = randomUUID();
    await writeFile(path.join(directory, `${invocationId}.json`), JSON.stringify({
      kind: "action-invocation", action: "openSwitchToTrafficDialog", invocationId, caseId: "case-3", driftSuspected: true,
      failure: { category: "locator" },
    }));
  }
  for (const file of options.files ?? []) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "evidence\n");
  }
  if (options.records !== undefined) {
    const body = typeof options.records === "string" ? options.records : options.records.map((record) => JSON.stringify(record)).join("\n");
    await writeFile(path.join(root, "run-state", "drift-repair.jsonl"), `${body}\n`);
  }
  return root;
}

const done = { action: "openSwitchToTrafficDialog", repair: "done", verifyRef: "evidence/case-9/verify.json" };
const stuck = {
  action: "openSwitchToTrafficDialog", repair: "not_attempted", gapId: "script-drift-openSwitchToTrafficDialog-run-1",
  blocker: "staging 组织里拿不到 PMax 草稿，弹窗只能在 PMax 草稿上打开", evidenceRef: "evidence/case-3/notes.md",
};

describe("drift repair gate", () => {
  it("leaves a run with no drift sign and no record untouched", async () => {
    const root = await runRoot();
    await expect(assertDriftRepairRecorded(root)).resolves.toEqual({ checked: false, actions: [] });
  });

  it("refuses a drift miss in the reuse log when drift-repair.jsonl is missing", async () => {
    const root = await runRoot({ drift: "miss" });
    await expect(assertDriftRepairRecorded(root)).rejects.toThrow(/drift-repair\.jsonl.*openSwitchToTrafficDialog/s);
  });

  it("refuses a driftSuspected invocation when drift-repair.jsonl is missing or has no row for that Action", async () => {
    const root = await runRoot({ drift: "invocation" });
    await expect(assertDriftRepairRecorded(root)).rejects.toThrow(/drift-repair\.jsonl/);
    const other = await runRoot({ drift: "invocation", records: [{ ...done, action: "readGoogleTrackingReadiness" }],
      files: ["evidence/case-9/verify.json"] });
    await expect(assertDriftRepairRecorded(other)).rejects.toThrow(/openSwitchToTrafficDialog.*no drift-repair/s);
  });

  it("accepts a done record that points at an existing verify result", async () => {
    const root = await runRoot({ drift: "miss", records: [done], files: ["evidence/case-9/verify.json"] });
    expect(await assertDriftRepairRecorded(root)).toEqual({ checked: true, actions: ["openSwitchToTrafficDialog"] });
  });

  it("refuses done without a verify reference, or one that is missing or outside the run", async () => {
    for (const verifyRef of [undefined, "", "evidence/case-9/nope.json", "../elsewhere.json", "/etc/hosts"]) {
      const root = await runRoot({ drift: "miss", records: [{ ...done, verifyRef }] });
      await expect(assertDriftRepairRecorded(root), String(verifyRef)).rejects.toThrow(/verifyRef/);
    }
  });

  it("accepts not_attempted / failed with a gap, a specific blocker and an existing evidence file", async () => {
    const root = await runRoot({ drift: "miss", records: [stuck, { ...stuck, repair: "failed" }], files: ["evidence/case-3/notes.md"] });
    await expect(assertDriftRepairRecorded(root)).resolves.toMatchObject({ checked: true });
  });

  it.each([
    "用户本轮明确要求不现场修改 skill 文件；按 skill 规则登记 script_drift 缺口",
    "用户说不要改 skill，所以没有修复",
    "时间不够，下一轮再修",
    "来不及修复这个 action",
    "同上",
    "N/A",
    "the user said not to edit files",
    "not enough time to repair it",
  ])("refuses the generic excuse: %s", async (blocker) => {
    const root = await runRoot({ drift: "miss", records: [{ ...stuck, blocker }], files: ["evidence/case-3/notes.md"] });
    await expect(assertDriftRepairRecorded(root)).rejects.toThrow(/blocker/);
  });

  it("refuses a blocker without a gap id or without an existing evidence file", async () => {
    const noGap = await runRoot({ drift: "miss", records: [{ ...stuck, gapId: undefined }], files: ["evidence/case-3/notes.md"] });
    await expect(assertDriftRepairRecorded(noGap)).rejects.toThrow(/gapId/);
    const noEvidence = await runRoot({ drift: "miss", records: [{ ...stuck, evidenceRef: "evidence/case-3/gone.md" }] });
    await expect(assertDriftRepairRecorded(noEvidence)).rejects.toThrow(/evidenceRef/);
  });

  it("uses the latest record per Action, so a correction row supersedes a wrong earlier reason", async () => {
    const wrong = { ...stuck, blocker: "用户要求不现场修改 skill 文件", evidenceRef: undefined };
    const root = await runRoot({ drift: "miss", records: [wrong, done], files: ["evidence/case-9/verify.json"] });
    await expect(assertDriftRepairRecorded(root)).resolves.toMatchObject({ checked: true });
    const regress = await runRoot({ drift: "miss", records: [done, wrong], files: ["evidence/case-9/verify.json"] });
    await expect(assertDriftRepairRecorded(regress)).rejects.toThrow(/blocker/);
  });

  it("validates rows even when the run shows no drift sign, and rejects malformed lines", async () => {
    const root = await runRoot({ records: [{ action: "x", repair: "maybe" }] });
    await expect(assertDriftRepairRecorded(root)).rejects.toThrow(/repair/);
    const broken = await runRoot({ records: "{not json" });
    await expect(assertDriftRepairRecorded(broken)).rejects.toThrow(/line 1/);
  });

  it("reads a repaired row from an older action:drift verify (outcome only) through its invocation fact", async () => {
    const invocationId = randomUUID();
    const root = await runRoot({ drift: "miss", files: [`evidence/D1/playwright/actions/${invocationId}.json`],
      records: [{ action: "openSwitchToTrafficDialog", caseId: "D1", outcome: "repaired", invocationId, rerunStatus: "completed" }] });
    await expect(assertDriftRepairRecorded(root)).resolves.toMatchObject({ checked: true });
    const missing = await runRoot({ drift: "miss",
      records: [{ action: "openSwitchToTrafficDialog", caseId: "D1", outcome: "repaired", invocationId, rerunStatus: "completed" }] });
    await expect(assertDriftRepairRecorded(missing)).rejects.toThrow(/verifyRef/);
  });

  it("exposes the record validation for tooling", () => {
    expect(validateDriftRepairRecords([{ action: "a", repair: "done" }], "/nonexistent")).toEqual(
      expect.arrayContaining([expect.stringMatching(/verifyRef/)]));
  });
});
