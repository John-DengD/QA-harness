import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  actionIndex, actionsFromSource, findActions, hasReuseEvent, parseReuseLog, summarizeReuse, validateReuseEvent,
  type ActionEntry, type ReuseEvent,
} from "../../src/tools/action-index";
import { canonicalInvocationJson, sha256Bytes } from "../../src/tools/action-invocation";

describe("Action reuse index", () => {
  it("finds Settings Actions used by the historical B2 case", async () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const hotlist = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
    const entries = await actionIndex(root, hotlist.actions);
    expect(findActions(entries, "open dashboard settings", "settings").map((entry) => entry.name))
      .toContain("openDashboardSettings");
    expect(findActions(entries, "open organization settings", "settings").map((entry) => entry.name))
      .toContain("selectSettingsTab");
  });

  it("indexes exported UI Actions and excludes non-UI helpers", () => {
    const entries = actionsFromSource(`
      export async function openCampaign(page: Page, id: string) { return id; }
      export const readCampaign = async (page: Page) => ({ visible: true });
      export const formatCampaign = (id: string) => id;
      async function privateAction(page: Page) { return page; }
    `, "src/actions/campaign-actions.ts");
    expect(entries.map((entry) => entry.name)).toEqual(["openCampaign", "readCampaign"]);
    expect(entries[0].domain).toBe("campaign");
  });

  it("uses relevant hot matches before cold matches, not unrelated hot entries", () => {
    const entries: ActionEntry[] = [
      { name: "openStudioLibrary", domain: "studio", file: "s.ts", line: 1, signature: "", hot: true },
      { name: "openCampaignList", domain: "campaign", file: "c.ts", line: 1, signature: "", hot: true },
      { name: "openCampaignDraft", domain: "campaign", file: "c.ts", line: 2, signature: "", hot: false },
    ];
    expect(findActions(entries, "open campaign", "campaign").map((entry) => entry.name))
      .toEqual(["openCampaignList", "openCampaignDraft"]);
  });

  it("rejects misleading hits and summarizes eligible intents only", () => {
    expect(() => validateReuseEvent({
      runId: "run", caseId: "case", intentId: "submit-1", intent: "submit", outcome: "hit",
      source: "computer-use", lookupMs: 1, executionMs: 2,
    })).toThrow(/hit needs/);
    const events = [
      { runId: "r", caseId: "a", intentId: "1", intent: "open", outcome: "hit", source: "hot", action: "openCampaignList", invocationId: randomUUID(), factRef: "../evidence/a/playwright/actions/fact.json", factSha256: "a".repeat(64), lookupMs: 3, executionMs: 10 },
      { runId: "r", caseId: "a", intentId: "2", intent: "select", outcome: "miss", source: "computer-use", reason: "not_found", lookupMs: 8, executionMs: 20 },
      { runId: "r", caseId: "a", intentId: "3", intent: "visual", outcome: "not_reusable", source: "none", notReusableReason: "visual_only", lookupMs: 0, executionMs: 5 },
    ].map(validateReuseEvent) as ReuseEvent[];
    expect(summarizeReuse(events)).toMatchObject({
      eligibleIntents: 2, hits: 1, hotHits: 1, misses: 1, excludedIntents: 1,
      hitRate: 0.5, missReasons: { not_found: 1 }, totalLookupMs: 11,
    });
    expect(() => summarizeReuse([...events, events[0]])).toThrow(/Duplicate/);
  });

  it("requires a preflight header and one run ID across the append-only log", () => {
    const header = { kind: "preflight", runId: "r1", createdAt: "2026-10-10T10:00:00.000Z", indexedActions: 4, hotCandidates: ["openCampaignList"] };
    const event = validateReuseEvent({
      runId: "r1", caseId: "case-1", intentId: "open-list", intent: "open campaign list",
      outcome: "miss", source: "computer-use", reason: "not_found", lookupMs: 2, executionMs: 4,
    });
    expect(parseReuseLog(`${JSON.stringify(header)}\n${JSON.stringify(event)}\n`).events).toEqual([event]);
    expect(() => parseReuseLog("")).toThrow(/empty/);
    expect(() => parseReuseLog(`${JSON.stringify(event)}\n`)).toThrow(/preflight/);
    expect(() => parseReuseLog(`${JSON.stringify(header)}\n${JSON.stringify({ ...event, runId: "r2" })}\n`)).toThrow(/different runId/);
    expect(() => parseReuseLog(`${JSON.stringify(header)}\n${JSON.stringify(event)}\n${JSON.stringify(event)}\n`)).toThrow(/Duplicate/);
  });

  it("fails a missing or unmeasured run and records a miss without changing its denominator", async () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const dir = await mkdtemp(path.join(os.tmpdir(), "qa-action-reuse-"));
    const log = path.join(dir, "action-reuse.jsonl");
    const invoke = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/action-reuse.ts", ...args], {
      cwd: root, encoding: "utf8",
    });
    try {
      const missing = invoke("summary", "--log", log);
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain("metrics are unmeasured");

      const preflight = invoke("preflight", "--log", log, "--run-id", "run-1", "--domain", "campaign");
      expect(preflight.status).toBe(0);
      expect(JSON.parse(preflight.stdout).indexedActions).toBeGreaterThan(0);
      expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
      expect(invoke("summary", "--log", log).stderr).toContain("no executed intents");
      expect(invoke("preflight", "--log", log, "--run-id", "run-1").stderr).toContain("already exists");

      // absent is cross-checked against the library: readGoogleTrackingReadiness exists.
      const covered = invoke("record", "--log", log, "--event", JSON.stringify({
        runId: "run-1", caseId: "case-1", intentId: "tracking", intent: "read tracking readiness",
        outcome: "miss", source: "computer-use", reason: "absent", lookupMs: 8, executionMs: 20,
      }));
      expect(covered.status).not.toBe(0);
      expect(covered.stderr).toContain("readGoogleTrackingReadiness (runnable)");
      const primitive = invoke("record", "--log", log, "--event", JSON.stringify({
        runId: "run-1", caseId: "case-1", intentId: "c6-return-draft-tab", intent: "切回草稿标签",
        outcome: "miss", source: "computer-use", reason: "absent", lookupMs: 0, executionMs: 20,
      }));
      expect(primitive.stderr).toContain("browser primitive");
      const event = JSON.stringify({
        runId: "run-1", caseId: "case-1", intentId: "tracking", intent: "read tracking readiness",
        outcome: "miss", source: "computer-use", reason: "not_found", action: "readGoogleTrackingReadiness",
        lookupMs: 8, executionMs: 20,
      });
      expect(invoke("record", "--log", log, "--event", event).status).toBe(0);
      const report = invoke("summary", "--log", log);
      expect(report.status).toBe(0);
      expect(JSON.parse(report.stdout)).toMatchObject({ runId: "run-1", eligibleIntents: 1, hits: 0, misses: 1, hitRate: 0 });
      expect(invoke("record", "--log", log, "--event", event).stderr).toContain("Duplicate");
      expect(invoke("record", "--log", log, "--event", event.replace('"run-1"', '"run-2"')).stderr)
        .toContain("does not match");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a claimed hit without a completed invocation fact tied to the current run and intent", async () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const dir = await mkdtemp(path.join(os.tmpdir(), "qa-hit-proof-"));
    const runDir = path.join(dir, "runs", "run-1");
    const log = path.join(runDir, "run-state", "action-reuse.jsonl");
    const invocationId = randomUUID();
    const factPath = path.join(runDir, "evidence", "case-1", "playwright", "actions", `${invocationId}.json`);
    const invoke = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/action-reuse.ts", ...args], {
      cwd: root, encoding: "utf8",
    });
    try {
      await mkdir(path.dirname(factPath), { recursive: true });
      expect(invoke("preflight", "--log", log, "--run-id", "run-1", "--domain", "campaign").status).toBe(0);
      const body = {
        kind: "action-invocation", schemaVersion: 1, invocationId, runId: "run-1", caseId: "case-1",
        intentId: "open-list", action: "openCampaignList", domain: "campaign", sandboxId: "sandbox1",
        origin: "https://qa.example.test", sideEffect: "read", status: "completed",
        startedAt: "2026-10-12T01:00:00Z", finishedAt: "2026-10-12T01:00:01Z",
        lookupMs: 5, executionMs: 10, factPath: `playwright/actions/${invocationId}.json`,
        beforeScreenshot: `${invocationId}-before.png`, afterScreenshot: `${invocationId}-after.png`,
        target: { origin: "https://qa.example.test", beforeScreenshot: `playwright/actions/${invocationId}-before.png`,
          afterScreenshot: `playwright/actions/${invocationId}-after.png` },
        fact: { visible: true }, error: null as string | null,
      };
      const saveFact = async (value: typeof body) => {
        const bytes = JSON.stringify({ ...value, integrityHash: sha256Bytes(canonicalInvocationJson(value)) }) + "\n";
        await writeFile(factPath, bytes);
        return sha256Bytes(bytes);
      };
      const factRef = path.relative(path.dirname(log), factPath);
      const event = {
        runId: "run-1", caseId: "case-1", intentId: "open-list", intent: "open campaign list",
        outcome: "hit", source: "hot", action: "openCampaignList", lookupMs: 5, executionMs: 10,
        invocationId, factRef, factSha256: "a".repeat(64),
      };
      await saveFact(body);
      expect(invoke("record", "--log", log, "--event", JSON.stringify(event)).stderr).toContain("hash does not match");
      event.factSha256 = await saveFact({ ...body, status: "failed", error: "click failed" });
      expect(invoke("record", "--log", log, "--event", JSON.stringify(event)).stderr).toContain("completed invocation");
      event.factSha256 = await saveFact({ ...body, caseId: "case-2" });
      expect(invoke("record", "--log", log, "--event", JSON.stringify(event)).stderr).toContain("not tied to the reuse event");
      event.factSha256 = await saveFact(body);
      expect(invoke("record", "--log", log, "--event", JSON.stringify(event)).status).toBe(0);
      expect(JSON.parse(invoke("summary", "--log", log).stdout)).toMatchObject({ hits: 1, hitRate: 1 });
      await writeFile(factPath, "altered fact bytes");
      expect(invoke("summary", "--log", log).stderr).toContain("hash does not match");
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 20_000);
});

describe("non-Case phases and cross-check settlement in the reuse log", () => {
  const header = { kind: "preflight", runId: "r1", createdAt: "2026-10-10T10:00:00.000Z", indexedActions: 4, hotCandidates: [] };
  const hit = (caseId: string, intentId: string, action = "selectOrganization") => ({
    runId: "r1", caseId, intentId, intent: intentId, outcome: "hit", source: "index", action,
    invocationId: randomUUID(), factRef: "../evidence/x/playwright/actions/f.json", factSha256: "a".repeat(64), lookupMs: 1, executionMs: 2,
  });
  const pending = (caseId: string, intentId: string) => ({
    ...hit(caseId, intentId, "readGoogleTrackingReadiness"), outcome: "pending_crosscheck",
    crossCheckReasons: ["cardState 取值 unrecognized 不在合法取值内（missing, waiting）"],
  });
  const log = (...lines: unknown[]) => [header, ...lines].map((line) => JSON.stringify(line)).join("\n") + "\n";

  it("counts setup/cleanup calls separately, outside the Case hit-rate denominator", () => {
    const parsed = parseReuseLog(log(hit("setup", "sign-in"), hit("case-1", "select-org"),
      { runId: "r1", caseId: "case-1", intentId: "rename", intent: "rename", outcome: "miss", source: "computer-use", reason: "absent", lookupMs: 0, executionMs: 1 },
      hit("cleanup", "select-org-1"), hit("cleanup", "sign-out", "signOutAccount")));
    expect(summarizeReuse(parsed.events)).toMatchObject({
      eligibleIntents: 2, hits: 1, misses: 1, hitRate: 0.5,
      phases: { setup: { intents: 1, hits: 1 }, cleanup: { intents: 2, hits: 2 } },
    });
  });

  it("keeps a pending cross-check out of the hits until it is confirmed, then folds it into a hit or a drift miss", () => {
    const open = parseReuseLog(log(pending("case-2", "read-tracking")));
    expect(open.pendingCrossChecks.map((event) => event.intentId)).toEqual(["read-tracking"]);
    expect(summarizeReuse(open.events)).toMatchObject({ eligibleIntents: 1, hits: 0, pendingCrossChecks: 1, hitRate: 0 });

    const resolution = (result: "hit" | "drift") => ({ kind: "crosscheck_resolution", runId: "r1", caseId: "case-2",
      intentId: "read-tracking", result, confirmedAt: "2026-10-15T07:00:00.000Z" });
    const confirmed = parseReuseLog(log(pending("case-2", "read-tracking"), resolution("hit")));
    expect(confirmed.pendingCrossChecks).toEqual([]);
    expect(confirmed.events[0]).toMatchObject({ outcome: "hit", crossCheck: { result: "hit" } });
    expect(summarizeReuse(confirmed.events)).toMatchObject({ hits: 1, hitRate: 1, pendingCrossChecks: 0 });

    const refuted = parseReuseLog(log(pending("case-2", "read-tracking"), resolution("drift")));
    expect(refuted.events[0]).toMatchObject({ outcome: "miss", reason: "drift", source: "computer-use",
      action: "readGoogleTrackingReadiness", crossCheck: { result: "drift" } });

    expect(() => parseReuseLog(log(resolution("hit")))).toThrow(/no pending cross-check/);
    expect(() => parseReuseLog(log(pending("case-2", "read-tracking"), resolution("hit"), resolution("drift"))))
      .toThrow(/already settled/);
    // One run/case/intent still has one event, pending or not.
    expect(() => parseReuseLog(log(pending("case-2", "read-tracking"), hit("case-2", "read-tracking")))).toThrow(/Duplicate/);
  });

  it("still parses a log written before pending cross-checks and phases existed", () => {
    const old = parseReuseLog(log(hit("case-1", "a"), hit("cleanup", "b")));
    expect(old.events).toHaveLength(2);
    expect(old.pendingCrossChecks).toEqual([]);
  });
});

describe("action:reuse confirm settles a pending cross-check", () => {
  it("turns a confirmed reading into a hit, a refuted one into a drift miss that marks health", async () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const qaRoot = await mkdtemp(path.join(os.tmpdir(), "qa-confirm-"));
    const runDir = path.join(qaRoot, "User-Dashboard-test", "PR-1", "runs", "run-1");
    await mkdir(path.join(qaRoot, ".qa-loop"), { recursive: true });
    const log = path.join(runDir, "run-state", "action-reuse.jsonl");
    const invoke = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/action-reuse.ts", ...args], {
      cwd: root, encoding: "utf8",
    });
    const pendingFor = async (intentId: string) => {
      const invocationId = randomUUID();
      const factPath = path.join(runDir, "evidence", "case-2", "playwright", "actions", `${invocationId}.json`);
      await mkdir(path.dirname(factPath), { recursive: true });
      const body = {
        kind: "action-invocation", schemaVersion: 1, invocationId, runId: "run-1", caseId: "case-2", intentId,
        action: "readGoogleTrackingReadiness", domain: "google-tracking", sandboxId: "sandbox1",
        origin: "https://qa.example.test", sideEffect: "read", status: "completed",
        startedAt: "2026-10-15T01:00:00Z", finishedAt: "2026-10-15T01:00:01Z",
        lookupMs: 5, executionMs: 10, factPath: `playwright/actions/${invocationId}.json`,
        beforeScreenshot: `${invocationId}-before.png`, afterScreenshot: `${invocationId}-after.png`,
        target: { origin: "https://qa.example.test", beforeScreenshot: `playwright/actions/${invocationId}-before.png`,
          afterScreenshot: `playwright/actions/${invocationId}-after.png` },
        fact: { cardState: "unrecognized" }, error: null,
      };
      const bytes = JSON.stringify({ ...body, integrityHash: sha256Bytes(canonicalInvocationJson(body)) }) + "\n";
      await writeFile(factPath, bytes);
      return { runId: "run-1", caseId: "case-2", intentId, intent: "读取 Google 转化追踪状态", outcome: "pending_crosscheck",
        source: "index", action: "readGoogleTrackingReadiness", invocationId,
        factRef: path.relative(path.dirname(log), factPath), factSha256: sha256Bytes(bytes),
        crossCheckReasons: ["cardState 取值 unrecognized 不在合法取值内（missing, waiting, live, traffic, absent）"],
        lookupMs: 5, executionMs: 10 };
    };
    try {
      expect(invoke("preflight", "--log", log, "--run-id", "run-1").status).toBe(0);
      const ok = await pendingFor("read-ok");
      const bad = await pendingFor("read-bad");
      await writeFile(log, `${await readFile(log, "utf8")}${JSON.stringify(ok)}\n${JSON.stringify(bad)}\n`);
      const before = JSON.parse(invoke("summary", "--log", log).stdout);
      expect(before).toMatchObject({ hits: 0, pendingCrossChecks: 2 });

      const confirm = (intentId: string, result: string, ...extra: string[]) => invoke("confirm", "--log", log, "--run-id", "run-1",
        "--case-id", "case-2", "--intent-id", intentId, "--result", result, ...extra);
      expect(confirm("read-ok", "maybe").stderr).toContain("--result must be hit or drift");
      expect(confirm("nope", "hit").stderr).toContain("no pending cross-check");
      const hit = confirm("read-ok", "hit");
      expect(hit.status, hit.stderr).toBe(0);
      expect(JSON.parse(hit.stdout)).toMatchObject({ settled: true, result: "hit", event: { outcome: "hit" } });
      expect(confirm("read-ok", "drift").stderr).toContain("already settled");
      const drift = confirm("read-bad", "drift");
      expect(drift.status, drift.stderr).toBe(0);
      expect(JSON.parse(drift.stdout)).toMatchObject({ result: "drift", event: { outcome: "miss", reason: "drift" },
        health: { status: "suspected_drift", lastFailure: { category: "reported_drift" } } });
      expect(JSON.parse(invoke("summary", "--log", log).stdout)).toMatchObject({ hits: 1, misses: 1, pendingCrossChecks: 0,
        missReasons: { drift: 1 } });
      const health = JSON.parse(await readFile(path.join(qaRoot, ".qa-loop", "action-health.json"), "utf8"));
      expect(health.actions.readGoogleTrackingReadiness.status).toBe("suspected_drift");
    } finally { await rm(qaRoot, { recursive: true, force: true }); }
  }, 30_000);
});

describe("hasReuseEvent", () => {
  const event = (caseId: string, intentId: string, runId = "run-1") => ({
    runId, caseId, intentId, intent: intentId, outcome: "miss", source: "computer-use",
    reason: "absent", lookupMs: 0, executionMs: 0,
  }) as ReuseEvent;

  it("keys on run, case and intent, matching the summary's uniqueness rule", () => {
    const events = [event("C1", "read-tracking")];
    expect(hasReuseEvent(events, "run-1", "C1", "read-tracking")).toBe(true);
    // Another Case reusing the same intent is a separate, valid event.
    expect(hasReuseEvent(events, "run-1", "C2", "read-tracking")).toBe(false);
    expect(hasReuseEvent(events, "run-2", "C1", "read-tracking")).toBe(false);
  });
});
