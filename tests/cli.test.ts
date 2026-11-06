import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");

export function qa(args: string[], env: Record<string, string> = {}, cwd = ROOT) {
  const r = spawnSync(TSX, [path.join(ROOT, "src/cli.ts"), ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    input: "",
    timeout: 30000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

export function tmpConfig(overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-cli-"));
  const file = path.join(dir, "qa-harness.config.json");
  writeFileSync(
    file,
    JSON.stringify({
      runbook: { path: path.join(ROOT, "runbook") },
      runRoot: "runs",
      executor: { root: "executor" },
      llm: { model: "m" },
      ...overrides,
    }),
  );
  return { dir, file };
}

describe("qa doctor", () => {
  it("exits 0 and says ok for a valid config and runbook", () => {
    const { file } = tmpConfig();
    const r = qa(["doctor", "--config", file]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ok");
  });

  it("exits 2 naming the runbook path when it is missing", () => {
    const { file } = tmpConfig({ runbook: { path: "/nonexistent/runbook" } });
    const r = qa(["doctor", "--config", file]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("/nonexistent/runbook");
  });

  it("exits 2 naming the file when the config is missing", () => {
    const r = qa(["doctor", "--config", "/nonexistent/qa.config.json"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("/nonexistent/qa.config.json");
  });
});

const KEYS = { OPENAI_API_KEY: "sk-test-1234567890", E2B_API_KEY: "e2b-test-1234567890" };
const args = (cmd: string, file: string, runId = "r1") => [cmd, "--config", file, "--feature", "HEL-1", "--run-id", runId];

describe("stage commands", () => {
  it("fail at step 0 naming the missing secret, before looking at inputs", () => {
    const { file } = tmpConfig();
    const r = qa(args("design", file));
    expect(r.code).toBe(2);
    expect(r.err).toContain("OPENAI_API_KEY");
  });

  it("design exits 2 naming acceptance.json when the input artifact is missing", () => {
    const { dir, file } = tmpConfig();
    mkdirSync(path.join(dir, "runs/HEL-1/runs/r1"), { recursive: true });
    const r = qa(args("design", file), KEYS);
    expect(r.code).toBe(2);
    expect(r.err).toContain("acceptance.json");
  });

  it("design exits 2 naming the run dir when it does not exist", () => {
    const { file } = tmpConfig();
    const r = qa(args("design", file, "nope"), KEYS);
    expect(r.code).toBe(2);
    expect(r.err).toContain("nope");
  });

  it("each stage checks its own input: review->cases.json, run->cases.reviewed.json, report->results/", () => {
    const { dir, file } = tmpConfig({ executor: { root: "executor" } });
    // a minimal executor layout so the run stage's preflight passes and its input check is reached
    mkdirSync(path.join(dir, "executor", "node_modules"), { recursive: true });
    mkdirSync(path.join(dir, "qa-env"), { recursive: true });
    writeFileSync(path.join(dir, "qa-env", ".env.local"), "");
    mkdirSync(path.join(dir, "runs/HEL-1/runs/r1"), { recursive: true });
    const env = { ...KEYS, E2E_ACCOUNT_EMAIL: "a@b.test", CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_x" };
    const want: Record<string, string> = { review: "cases.json", run: "cases.reviewed.json", report: "results" };
    for (const [cmd, art] of Object.entries(want)) {
      const r = qa(args(cmd, file), env);
      expect(r.code, cmd).toBe(2);
      expect(r.err, cmd).toContain(art);
    }
  });

  it("run's preflight names what the executor is missing before anything else", () => {
    const { dir, file } = tmpConfig();
    mkdirSync(path.join(dir, "runs/HEL-1/runs/r1"), { recursive: true });
    const r = qa(args("run", file), KEYS);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/node_modules/);
    expect(r.err).toMatch(/E2E_ACCOUNT_EMAIL/);
  });

  it("design with acceptance.json but no sources.json exits 2 naming sources.json", () => {
    const { dir, file } = tmpConfig();
    const rd = path.join(dir, "runs/HEL-1/runs/r1");
    mkdirSync(rd, { recursive: true });
    writeFileSync(path.join(rd, "acceptance.json"), "{}");
    const r = qa(args("design", file), KEYS);
    expect(r.code).toBe(2);
    expect(r.err).toContain("sources.json");
  });

  it("extract without an input option exits 2 naming the four options; the run dir exists afterwards and is not reused without --force", () => {
    const { dir, file } = tmpConfig();
    const first = qa(args("extract", file), KEYS);
    expect(first.code).toBe(2);
    expect(first.err).toMatch(/--ticket.*--ticket-file.*--pr.*--goal/);
    expect(existsSync(path.join(dir, "runs/HEL-1/runs/r1"))).toBe(true);
    const second = qa(args("extract", file), KEYS);
    expect(second.code).toBe(2);
    expect(second.err).toContain("already exists");
    expect(qa([...args("extract", file), "--force"], KEYS).err).toMatch(/--ticket-file/);
  });

  it("requires --feature and --run-id", () => {
    const { file } = tmpConfig();
    const r = qa(["extract", "--config", file], KEYS);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--feature/);
  });

  it("all runs the run stage's preflight first, so a missing executor setup fails before any LLM call", () => {
    const { file } = tmpConfig();
    const r = qa(args("all", file), KEYS);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/node_modules|qa-env|E2E_ACCOUNT_EMAIL|CLERK/);
    expect(r.err).not.toContain("design not implemented");
  });

  it("never reads stdin: closed stdin cannot hang a command", () => {
    const { file } = tmpConfig();
    expect(qa(args("extract", file, "stdin-check"), KEYS).code).not.toBeNull();
  });
});
