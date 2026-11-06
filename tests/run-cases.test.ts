import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LlmTransport } from "../src/llm/structured";
import { runCases } from "../src/run/run-cases";
import type { PlaywrightRunner, RunDeps, SandboxDriver } from "../src/run/types";
import type { Runbook } from "../src/runbook";

const GOOD_CODE = `import { test, expect } from "./fixtures";\ntest("x", async ({ page }) => { await expect(page).toHaveURL(/x/); });`;
const SECRET = "e2b_secret_value_123456";
const mkCase = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, title, generator: "G1", type: "happy", expected: { text: "e", sourceRef: "linear:DEV-1", anchor: "a" },
  preconditions: [], risk: "r", testability: { state: "ready" }, ...over,
}) as never;
const runbook = (bindings: unknown[] = [], authorized: string[] = ["campaign-draft"]): Runbook => ({
  root: "/rb", modules: [{ id: "x", path: "QA-models/hellyeah/core-journeys.md", status: "draft", version: 1, lastReviewed: "d" }],
  text: (f: string) => (f === "script-bindings.json" ? JSON.stringify({ bindings }) : JSON.stringify({ authorized })),
});
const env = { kind: "staging", baseUrl: "https://staging.example.test" } as never;
const PASS = { suites: [{ specs: [{ tests: [{ results: [{ status: "passed" }] }] }] }] };
const FAIL = { suites: [{ specs: [{ tests: [{ results: [{ status: "failed", error: { message: "expect(locator).toHaveText(x) failed" } }] }] }] }] };

function fakes(over: { report?: unknown; bytes?: number; stopThrows?: boolean; pwThrows?: boolean; stdout?: string; gen?: string } = {}) {
  const log: string[] = [];
  const sandbox: SandboxDriver = {
    async create() { log.push("create"); return { sandboxId: "sb1" }; },
    async startRecording() { log.push("recStart"); },
    async stopRecording() { log.push("recStop"); if (over.stopThrows) throw new Error("ffprobe failed"); return { videoPath: "v.mp4", bytes: over.bytes ?? 1000 }; },
    async snapshot() { log.push("snapshot"); return "<html/>"; },
    async kill() { log.push("kill"); },
  };
  const playwright: PlaywrightRunner = {
    async run(o) { log.push(`pw:${o.specPath}`); if (over.pwThrows) throw new Error("spawn failed"); return { exitCode: over.report === FAIL ? 1 : 0, stdout: over.stdout ?? "", stderr: "", reportJson: over.report ?? PASS, timedOut: false }; },
  };
  const deps: RunDeps = { sandbox, playwright, registry: { async register() { log.push("register"); } }, validate: async () => ({ ok: true, output: "" }) };
  const transport: LlmTransport = { async complete() { log.push("llm"); return JSON.stringify({ code: over.gen ?? GOOD_CODE, sideEffects: [] }); } };
  return { log, deps, transport };
}
const dirs = () => { const d = mkdtempSync(path.join(tmpdir(), "qa-run-")); return d; };
const common = (runDir: string) => ({ env, runDir, runId: "r1", feature: "F", secrets: [SECRET], force: false, limits: { caseTimeoutMs: 1000, totalTimeoutMs: 10_000, maxRetries: 0 } });
const BOUND = [{ title: "Case A", spec: "tests/release/cases/a.spec.ts" }];
const result = (runDir: string, id: string) => JSON.parse(readFileSync(path.join(runDir, "results", `${id}.json`), "utf8"));

describe("runCases", () => {
  it("runs an existing script: Pass, result written, recording stopped, sandbox killed, registered first", async () => {
    const runDir = dirs(); const f = fakes();
    const r = await runCases({ ...common(runDir), cases: [mkCase("C01", "Case A")], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    expect(r.exitCode).toBe(0);
    expect(result(runDir, "C01")).toMatchObject({ caseId: "C01", verdict: "Pass", generated: false });
    expect(f.log).toEqual(["register", "create", "recStart", "pw:tests/release/cases/a.spec.ts", "recStop", "kill"]);
    expect(r.summary.executed).toEqual(["C01"]);
  });

  it("a recording of 0 bytes turns a passing script into Automation failure", async () => {
    const runDir = dirs(); const f = fakes({ bytes: 0 });
    const r = await runCases({ ...common(runDir), cases: [mkCase("C01", "Case A")], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    expect(result(runDir, "C01").verdict).toBe("Automation failure");
    expect(r.exitCode).toBe(20);
  });

  it("a failing recorder stop is Automation failure and the sandbox is still killed", async () => {
    const runDir = dirs(); const f = fakes({ stopThrows: true });
    await runCases({ ...common(runDir), cases: [mkCase("C01", "Case A")], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    expect(result(runDir, "C01").verdict).toBe("Automation failure");
    expect(f.log.at(-1)).toBe("kill");
  });

  it("a throwing Playwright run is Automation failure; recording stop and kill still happen", async () => {
    const runDir = dirs(); const f = fakes({ pwThrows: true });
    await runCases({ ...common(runDir), cases: [mkCase("C01", "Case A")], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    expect(result(runDir, "C01").verdict).toBe("Automation failure");
    expect(f.log.slice(-2)).toEqual(["recStop", "kill"]);
  });

  it("redacts secrets from saved script output", async () => {
    const runDir = dirs(); const f = fakes({ stdout: `token=${SECRET} ok` });
    await runCases({ ...common(runDir), cases: [mkCase("C01", "Case A")], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    const evidence = path.join(runDir, "evidence", "C01");
    for (const file of readdirSync(evidence)) expect(readFileSync(path.join(evidence, file), "utf8")).not.toContain(SECRET);
    expect(readFileSync(path.join(evidence, "playwright.stdout.txt"), "utf8")).toContain("[REDACTED]");
  });

  it("an authoritative assertion failure is ProductFail (exit 10)", async () => {
    const runDir = dirs(); const f = fakes({ report: FAIL });
    const r = await runCases({ ...common(runDir), cases: [mkCase("C01", "Case A")], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    expect(result(runDir, "C01").verdict).toBe("ProductFail");
    expect(r.exitCode).toBe(10);
  });

  it("an assertion failure on a draft-module Expected is Inconclusive", async () => {
    const runDir = dirs(); const f = fakes({ report: FAIL });
    const c = mkCase("C01", "Case A", { expected: { text: "e", sourceRef: "runbook:QA-models/hellyeah/core-journeys.md", anchor: "a" } });
    await runCases({ ...common(runDir), cases: [c], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    expect(result(runDir, "C01").verdict).toBe("Inconclusive");
  });

  it("generates a script when none exists; a generated assertion failure is Inconclusive and flagged", async () => {
    const runDir = dirs(); const f = fakes({ report: FAIL });
    const r = await runCases({ ...common(runDir), cases: [mkCase("C01", "No script")], runbook: runbook(), deps: f.deps, transport: f.transport });
    expect(result(runDir, "C01")).toMatchObject({ verdict: "Inconclusive", generated: true });
    expect(f.log).toEqual(["register", "create", "snapshot", "llm", "recStart", expect.stringMatching(/^pw:.*generated-specs/), "recStop", "kill"]);
    expect(existsSync(path.join(runDir, "generated-specs", "C01.spec.ts"))).toBe(true);
    expect(r.exitCode).toBe(20);
  });

  it("generation failure: not_automated, no result file, listed in the summary, exit 20, sandbox killed", async () => {
    const runDir = dirs(); const f = fakes();
    f.deps.validate = async () => ({ ok: false, output: "TS error" });
    const r = await runCases({ ...common(runDir), cases: [mkCase("C01", "No script")], runbook: runbook(), deps: f.deps, transport: f.transport });
    expect(existsSync(path.join(runDir, "results", "C01.json"))).toBe(false);
    expect(r.summary.notAutomated).toEqual([{ caseId: "C01", reason: expect.stringContaining("TS error") }]);
    expect(r.exitCode).toBe(20);
    expect(f.log.at(-1)).toBe("kill");
    expect(f.log).not.toContain("recStart");
  });

  it("a generated script with an unauthorised side effect is Blocked and never executed", async () => {
    const runDir = dirs(); const f = fakes();
    const transport: LlmTransport = { async complete() { return JSON.stringify({ code: GOOD_CODE, sideEffects: ["submit-payment"] }); } };
    const r = await runCases({ ...common(runDir), cases: [mkCase("C01", "No script")], runbook: runbook(), deps: f.deps, transport });
    expect(result(runDir, "C01").verdict).toBe("Blocked");
    expect(result(runDir, "C01").notes).toContain("submit-payment");
    expect(f.log.some((l) => l.startsWith("pw:"))).toBe(false);
    expect(r.exitCode).toBe(20);
  });

  it("Blocked and NotApplicable testability are recorded without creating a sandbox", async () => {
    const runDir = dirs(); const f = fakes();
    const cs = [mkCase("C01", "x", { testability: { state: "Blocked", reason: "needs org-B" } }), mkCase("C02", "y", { testability: { state: "NotApplicable", reason: "not in env" } })];
    const r = await runCases({ ...common(runDir), cases: cs, runbook: runbook(), deps: f.deps, transport: f.transport });
    expect(result(runDir, "C01")).toMatchObject({ verdict: "Blocked" });
    expect(result(runDir, "C02")).toMatchObject({ verdict: "NotApplicable" });
    expect(f.log).toEqual([]);
    expect(r.exitCode).toBe(20);
  });

  it("when the total timeout expires, remaining cases are skipped and the exit code is 20", async () => {
    const runDir = dirs(); const f = fakes();
    let t = 0;
    const r = await runCases({ ...common(runDir), limits: { caseTimeoutMs: 1000, totalTimeoutMs: 100, maxRetries: 0 }, now: () => (t += 60), cases: [mkCase("C01", "Case A"), mkCase("C02", "Case A"), mkCase("C03", "Case A")], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    expect(r.summary.skipped.map((s) => s.caseId)).toEqual(expect.arrayContaining(["C03"]));
    expect(r.summary.skipped.length).toBeGreaterThan(0);
    expect(r.exitCode).toBe(20);
  });

  it("registers the run exactly once, before the first sandbox", async () => {
    const runDir = dirs(); const f = fakes();
    await runCases({ ...common(runDir), cases: [mkCase("C01", "Case A"), mkCase("C02", "Case A")], runbook: runbook(BOUND), deps: f.deps, transport: f.transport });
    expect(f.log.filter((l) => l === "register")).toHaveLength(1);
    expect(f.log.indexOf("register")).toBeLessThan(f.log.indexOf("create"));
  });

  it("writes nothing and registers nothing when there are no cases", async () => {
    const runDir = dirs(); const f = fakes();
    const r = await runCases({ ...common(runDir), cases: [], runbook: runbook(), deps: f.deps, transport: f.transport });
    expect(r.exitCode).toBe(0);
    expect(f.log).toEqual([]);
  });
});
