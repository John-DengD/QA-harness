import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runRun } from "../src/commands/run";
import type { CommandContext } from "../src/commands/types";
import type { LlmTransport } from "../src/llm/structured";
import type { RunDeps } from "../src/run/types";
import { loadRunbook } from "../src/runbook";

const SECRET = "e2b_secret_value_123456";
const PASS = { suites: [{ specs: [{ tests: [{ results: [{ status: "passed" }] }] }] }] };
const FAIL = { suites: [{ specs: [{ tests: [{ results: [{ status: "failed", error: { message: "expect(locator).toHaveText(x) failed" } }] }] }] }] };
const kase = (id: string, title: string) => ({ id, title, generator: "G1", type: "happy", expected: { text: "e", sourceRef: "linear:DEV-1", anchor: "a" }, preconditions: [], risk: "r", testability: { state: "ready" } });

function setup(cases: unknown[], withEnv = true) {
  const root = mkdtempSync(path.join(tmpdir(), "qa-rc-"));
  const runDir = path.join(root, "F", "runs", "r1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "cases.reviewed.json"), JSON.stringify({ cases }));
  if (withEnv) writeFileSync(path.join(runDir, "env.json"), JSON.stringify({ kind: "staging", baseUrl: "https://staging.example.test" }));
  const rb = loadRunbook(path.resolve(__dirname, "../runbook"));
  const runbook = { ...rb, text: (f: string) => (f === "script-bindings.json" ? JSON.stringify({ bindings: [{ title: "Case A", spec: "a.spec.ts" }, { title: "Case B", spec: "b.spec.ts" }] }) : rb.text(f)) };
  const c: CommandContext = { config: { llm: { maxRetries: 0 }, run: { caseTimeoutMs: 1000, totalTimeoutMs: 100000 } } as never, runbook, runDir, env: { E2B_API_KEY: SECRET }, force: false, args: {} };
  const logs: string[] = [];
  const deps: RunDeps = {
    sandbox: { async create() { return { sandboxId: "s" }; }, async startRecording() {}, async stopRecording() { return { videoPath: "v", bytes: 5 }; }, async snapshot() { return ""; }, async kill() {} },
    playwright: { async run(o) { const fail = o.specPath === "b.spec.ts"; return { exitCode: fail ? 1 : 0, stdout: `key ${SECRET}`, stderr: "", reportJson: fail ? FAIL : PASS, timedOut: false }; } },
    registry: { async register() { logs.push("registered"); } },
    validate: async () => ({ ok: true, output: "" }),
  };
  const transport: LlmTransport = { async complete() { throw new Error("not expected"); } };
  return { c, runDir, deps, transport, logs, r: (n: string) => JSON.parse(readFileSync(path.join(runDir, n), "utf8")) };
}

describe("runRun", () => {
  it("runs the kept cases, writes results and run-summary.json, exits 10 on a ProductFail", async () => {
    const x = setup([kase("C01", "Case A"), kase("C02", "Case B")]);
    expect(await runRun(x.c, { runDeps: x.deps, transport: x.transport })).toBe(10);
    expect(x.r("results/C01.json").verdict).toBe("Pass");
    expect(x.r("results/C02.json").verdict).toBe("ProductFail");
    expect(x.r("run-summary.json").executed).toEqual(["C01", "C02"]);
  });
  it("redacts secrets from the ctx.env in saved output", async () => {
    const x = setup([kase("C01", "Case A")]);
    await runRun(x.c, { runDeps: x.deps, transport: x.transport });
    expect(readFileSync(path.join(x.runDir, "evidence/C01/playwright.stdout.txt"), "utf8")).not.toContain(SECRET);
  });
  it("exits 2 naming env.json when it is missing", async () => {
    const x = setup([kase("C01", "Case A")], false);
    const errs: string[] = []; const spy = console.error; console.error = (m: string) => errs.push(String(m));
    try { expect(await runRun(x.c, { runDeps: x.deps, transport: x.transport })).toBe(2); } finally { console.error = spy; }
    expect(errs.join()).toContain("env.json");
  });
  it("with no kept case exits 0 without registering the run", async () => {
    const x = setup([]);
    expect(await runRun(x.c, { runDeps: x.deps, transport: x.transport })).toBe(0);
    expect(x.logs).toEqual([]);
    expect(existsSync(path.join(x.runDir, "run-summary.json"))).toBe(true);
  });
  it("a second run without --force exits 2 naming what exists, before creating any sandbox", async () => {
    const x = setup([kase("C01", "Case A")]);
    expect(await runRun(x.c, { runDeps: x.deps, transport: x.transport })).toBe(0);
    const calls: string[] = [];
    x.deps.sandbox.create = async () => { calls.push("create"); return { sandboxId: "s" }; };
    const errs: string[] = []; const spy = console.error; console.error = (m: string) => errs.push(String(m));
    try { expect(await runRun(x.c, { runDeps: x.deps, transport: x.transport })).toBe(2); } finally { console.error = spy; }
    expect(errs.join()).toMatch(/results|evidence|run-summary/);
    expect(calls).toEqual([]);
  });
  it("--force clears the earlier run's evidence and results, then runs", async () => {
    const x = setup([kase("C01", "Case A")]);
    await runRun(x.c, { runDeps: x.deps, transport: x.transport });
    writeFileSync(path.join(x.runDir, "evidence", "C01", "stale.txt"), "old");
    x.c.force = true;
    expect(await runRun(x.c, { runDeps: x.deps, transport: x.transport })).toBe(0);
    expect(existsSync(path.join(x.runDir, "evidence", "C01", "stale.txt"))).toBe(false);
    expect(x.r("results/C01.json").verdict).toBe("Pass");
    expect(existsSync(path.join(x.runDir, "cases.reviewed.json"))).toBe(true);
  });
});
