import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureGeneratedHarness, makePlaywrightRunner, makeRegistry, makeSandboxDriver, makeScriptValidator } from "../src/run/real-deps";
import type { ExecLike, ExecOptions } from "../src/sources/types";

type Call = { cmd: string; args: string[]; opts: ExecOptions };
function fakeExec(handler: (c: Call) => { code?: number; stdout?: string; stderr?: string; timedOut?: boolean } = () => ({})) {
  const calls: Call[] = [];
  const exec: ExecLike = async (cmd, args, opts = {}) => {
    const call = { cmd, args, opts };
    calls.push(call);
    const r = handler(call);
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: r.timedOut };
  };
  return { exec, calls };
}
const tmp = () => mkdtempSync(path.join(tmpdir(), "qa-rd-"));
const SECRET = "e2b_secret_value_123456";
const env = { E2B_API_KEY: SECRET, PATH: "/usr/bin" };

describe("makeSandboxDriver", () => {
  it("create runs qa-sandbox in the executor with the environment and parses the sandbox id", async () => {
    const f = fakeExec(() => ({ stdout: 'noise\n{"sandboxId":"sb123"}\n' }));
    const d = makeSandboxDriver({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec });
    expect(await d.create({ url: "https://x.test" })).toEqual({ sandboxId: "sb123" });
    expect(f.calls[0]).toMatchObject({ cmd: "pnpm", args: ["exec", "tsx", "scripts/qa-sandbox.ts", "create", "--url", "https://x.test"], opts: { cwd: "/ex" } });
    expect(f.calls[0]!.opts.env!.E2B_API_KEY).toBe(SECRET);
  });
  it("record start/stop, snapshot and kill build the right commands", async () => {
    const f = fakeExec((c) => ({ stdout: c.args[3] === "record-stop" ? '{"video":"/v.mp4","bytes":42,"durationSeconds":3}' : c.args[3] === "snapshot" ? '{"url":"u","title":"t","snapshot":"- button \\"Save\\""}' : "{}" }));
    const d = makeSandboxDriver({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec });
    await d.startRecording("sb1", "/run/evidence/C01");
    expect(await d.stopRecording("sb1", "/run/evidence/C01")).toEqual({ videoPath: "/v.mp4", bytes: 42 });
    expect(await d.snapshot("sb1", "https://x.test")).toContain("button");
    await d.kill("sb1");
    expect(f.calls.map((c) => c.args.slice(3, 5).join(" "))).toEqual(["record-start --sandbox-id", "record-stop --sandbox-id", "snapshot --sandbox-id", "kill --sandbox-id"]);
  });
  it("create and snapshot tell the executor which origin the harness resolved (QA_ALLOWED_ORIGINS)", async () => {
    const f = fakeExec((c) => ({ stdout: c.args[3] === "create" ? '{"sandboxId":"sb1"}' : '{"url":"u","title":"t","snapshot":"s"}' }));
    const d = makeSandboxDriver({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec });
    await d.create({ url: "https://dashboard-abc.example.test/start" });
    await d.snapshot("sb1", "https://dashboard-abc.example.test");
    expect(f.calls.map((c) => c.opts.env!.QA_ALLOWED_ORIGINS)).toEqual(["https://dashboard-abc.example.test", "https://dashboard-abc.example.test"]);
  });
  it("a failing command throws with stderr and without secret values", async () => {
    const f = fakeExec(() => ({ code: 1, stderr: `boom ${SECRET}` }));
    const err = await makeSandboxDriver({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec }).create({ url: "u" }).catch((e) => e);
    expect(err.message).toContain("boom");
    expect(err.message).not.toContain(SECRET);
  });
});

describe("ensureGeneratedHarness", () => {
  it("links node_modules and writes the fixtures shim, config and tsconfig", () => {
    const ex = tmp(); mkdirSync(path.join(ex, "node_modules")); writeFileSync(path.join(ex, "playwright.config.ts"), "export default {}");
    mkdirSync(path.join(ex, "src")); writeFileSync(path.join(ex, "src", "fixtures.ts"), "export {}");
    const dir = path.join(tmp(), "generated-specs");
    ensureGeneratedHarness(dir, ex);
    ensureGeneratedHarness(dir, ex); // idempotent
    expect(lstatSync(path.join(dir, "node_modules")).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(dir, "fixtures.ts"), "utf8")).toContain(path.join(ex, "src", "fixtures"));
    expect(readFileSync(path.join(dir, "playwright.config.ts"), "utf8")).toContain(path.join(ex, "playwright.config"));
    expect(existsSync(path.join(dir, "tsconfig.json"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))).toEqual({ type: "module" });
  });
});

describe("makePlaywrightRunner", () => {
  const out = tmp();
  it("runs an existing spec from the executor with the output dir and reads the JSON report", async () => {
    const reportPath = path.join(out, "report.json");
    const f = fakeExec((c) => { writeFileSync(c.opts.env!.PLAYWRIGHT_JSON_OUTPUT_NAME!, JSON.stringify({ suites: [] })); return { stdout: "ok" }; });
    const r = makePlaywrightRunner({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec });
    const res = await r.run({ sandboxId: "sb1", specPath: "tests/release/cases/a.spec.ts", grep: "B1", outputDir: out, timeoutMs: 5000 });
    expect(f.calls[0]!.args).toEqual(["exec", "tsx", "scripts/run-e2b-playwright.ts", "sb1", "tests/release/cases/a.spec.ts", "--grep", "B1", "--reporter=json"]);
    expect(f.calls[0]!.opts).toMatchObject({ cwd: "/ex", timeoutMs: 5000 });
    expect(f.calls[0]!.opts.env).toMatchObject({ E2E_TEST_OUTPUT_DIR: out, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath });
    expect(res).toMatchObject({ exitCode: 0, reportJson: { suites: [] }, timedOut: false });
  });
  it("passes timeouts through and tolerates a missing report", async () => {
    const f = fakeExec(() => ({ code: 143, timedOut: true }));
    const res = await makePlaywrightRunner({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec }).run({ sandboxId: "sb1", specPath: "tests/a.spec.ts", outputDir: tmp(), timeoutMs: 1 });
    expect(res).toMatchObject({ timedOut: true, reportJson: null, exitCode: 143 });
  });
  it("a generated spec outside the executor gets its own config", async () => {
    const ex = tmp(); mkdirSync(path.join(ex, "node_modules")); writeFileSync(path.join(ex, "playwright.config.ts"), ""); mkdirSync(path.join(ex, "src")); writeFileSync(path.join(ex, "src", "fixtures.ts"), "");
    const gen = path.join(tmp(), "generated-specs"); mkdirSync(gen);
    const spec = path.join(gen, "C01.spec.ts"); writeFileSync(spec, "x");
    const f = fakeExec();
    await makePlaywrightRunner({ executorRoot: ex, qaRoot: "/runs", env, exec: f.exec }).run({ sandboxId: "sb1", specPath: spec, outputDir: tmp(), timeoutMs: 1000 });
    expect(f.calls[0]!.args).toEqual(expect.arrayContaining(["--config", path.join(gen, "playwright.config.ts"), spec]));
    expect(existsSync(path.join(gen, "fixtures.ts"))).toBe(true);
  });
});

describe("makeRegistry", () => {
  it("calls loop:state init with sanitised identifiers and the run-relative task model", async () => {
    const f = fakeExec((c) => (c.args.includes("inspect") ? { code: 1 } : {}));
    const reg = makeRegistry({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec });
    await reg.register({ runDir: "/runs/HEL 1/runs/r1", runId: "r1", feature: "HEL 1", env: { kind: "pr-sandbox", baseUrl: "https://x.test", headSha: "3a5a2ab" + "c".repeat(33), prNumber: 9 } as never, taskModelRef: "cases.reviewed.json" });
    const a = f.calls.find((c) => c.args.includes("init"))!.args;
    expect(a.slice(0, 4)).toEqual(["exec", "tsx", "scripts/loop-state.ts", "init"]);
    const get = (flag: string) => a[a.indexOf(flag) + 1];
    expect(get("--qa-root")).toBe("/runs");
    expect(get("--run-id")).toBe("r1");
    expect(get("--run-root")).toBe("HEL-1/runs/r1");
    expect(get("--feature")).toBe("HEL-1");
    expect(get("--environment")).toBe("pr-sandbox");
    expect(get("--task-model")).toBe("HEL-1/runs/r1/cases.reviewed.json");
    expect(get("--executor-id")).toBe("qa-harness");
  });
  it("reuses an existing registration of the same run (a re-run does not crash)", async () => {
    const f = fakeExec((c) => (c.args.includes("inspect") ? { stdout: JSON.stringify({ runId: "r1", runRoot: "F/runs/r1" }) } : {}));
    await makeRegistry({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec }).register({ runDir: "/runs/F/runs/r1", runId: "r1", feature: "F", env: { kind: "staging", baseUrl: "https://x" } as never, taskModelRef: "cases.reviewed.json" });
    expect(f.calls.some((c) => c.args.includes("init"))).toBe(false);
  });
  it("pins QA_ROOT to the run root for every executor subprocess", async () => {
    const f = fakeExec(() => ({ stdout: "{}" }));
    const e = { ...env, QA_ROOT: "/somewhere/else" };
    await makeSandboxDriver({ executorRoot: "/ex", qaRoot: "/runs", env: e, exec: f.exec }).kill("sb1");
    await makePlaywrightRunner({ executorRoot: "/ex", qaRoot: "/runs", env: e, exec: f.exec }).run({ sandboxId: "s", specPath: "a.spec.ts", outputDir: tmp(), timeoutMs: 1 });
    await makeRegistry({ executorRoot: "/ex", qaRoot: "/runs", env: e, exec: fakeExec((c) => (c.args.includes("inspect") ? { code: 1 } : {})).exec }).register({ runDir: "/runs/F/runs/r1", runId: "r1", feature: "F", env: { kind: "staging", baseUrl: "https://x" } as never, taskModelRef: "c.json" });
    expect(f.calls.every((c) => c.opts.env!.QA_ROOT === "/runs")).toBe(true);
  });
  it("throws an ExternalError (exit 3) with the command output when registration fails", async () => {
    const f = fakeExec(() => ({ code: 1, stderr: "already registered" }));
    const err = await makeRegistry({ executorRoot: "/ex", qaRoot: "/runs", env, exec: f.exec }).register({ runDir: "/runs/F/runs/r1", runId: "r1", feature: "F", env: { kind: "staging", baseUrl: "https://x" } as never, taskModelRef: "cases.reviewed.json" }).catch((e) => e);
    expect(err.message).toContain("already registered");
    expect(err.exitCode).toBe(3);
  });
});

describe("makeScriptValidator", () => {
  const ex = tmp(); mkdirSync(path.join(ex, "node_modules", ".bin"), { recursive: true }); writeFileSync(path.join(ex, "playwright.config.ts"), ""); mkdirSync(path.join(ex, "src")); writeFileSync(path.join(ex, "src", "fixtures.ts"), "");
  const specDir = () => { const d = path.join(tmp(), "generated-specs"); mkdirSync(d); writeFileSync(path.join(d, "C01.spec.ts"), "x"); return path.join(d, "C01.spec.ts"); };
  it("is ok when type-check and --list both succeed", async () => {
    const f = fakeExec();
    const v = makeScriptValidator({ executorRoot: ex, qaRoot: "/runs", env, exec: f.exec });
    expect((await v(specDir())).ok).toBe(true);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.args.join(" ")).toContain("tsc");
    expect(f.calls[1]!.args.join(" ")).toContain("--list");
  });
  it("fails with the tool output when type-check fails, and does not run --list", async () => {
    const f = fakeExec((c) => (c.args.join(" ").includes("tsc") ? { code: 2, stdout: "C01.spec.ts(3,1): error TS2304" } : {}));
    const r = await makeScriptValidator({ executorRoot: ex, qaRoot: "/runs", env, exec: f.exec })(specDir());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("TS2304");
    expect(f.calls).toHaveLength(1);
  });
  it("fails when --list finds no test", async () => {
    const f = fakeExec((c) => (c.args.join(" ").includes("--list") ? { code: 1, stderr: "Error: No tests found" } : {}));
    const r = await makeScriptValidator({ executorRoot: ex, qaRoot: "/runs", env, exec: f.exec })(specDir());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("No tests found");
  });
});
