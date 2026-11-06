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
    const { dir, file } = tmpConfig();
    mkdirSync(path.join(dir, "runs/HEL-1/runs/r1"), { recursive: true });
    const want: Record<string, string> = { review: "cases.json", run: "cases.reviewed.json", report: "results" };
    for (const [cmd, art] of Object.entries(want)) {
      const r = qa(args(cmd, file), KEYS);
      expect(r.code, cmd).toBe(2);
      expect(r.err, cmd).toContain(art);
    }
  });

  it("design with its input present reaches the stage body: exit 1 'not implemented'", () => {
    const { dir, file } = tmpConfig();
    const rd = path.join(dir, "runs/HEL-1/runs/r1");
    mkdirSync(rd, { recursive: true });
    writeFileSync(path.join(rd, "acceptance.json"), "{}");
    const r = qa(args("design", file), KEYS);
    expect(r.code).toBe(1);
    expect(r.err).toContain("design not implemented");
  });

  it("extract creates the run dir, then refuses to reuse it without --force", () => {
    const { dir, file } = tmpConfig();
    const first = qa(args("extract", file), KEYS);
    expect(first.code).toBe(1);
    expect(first.err).toContain("extract not implemented");
    expect(existsSync(path.join(dir, "runs/HEL-1/runs/r1"))).toBe(true);
    expect(qa(args("extract", file), KEYS).code).toBe(2);
    expect(qa([...args("extract", file), "--force"], KEYS).code).toBe(1);
  });

  it("requires --feature and --run-id", () => {
    const { file } = tmpConfig();
    const r = qa(["extract", "--config", file], KEYS);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--feature/);
  });

  it("all stops at the first stage that returns non-zero", () => {
    const { file } = tmpConfig();
    const r = qa(args("all", file), KEYS);
    expect(r.code).toBe(1);
    expect(r.err).toContain("extract not implemented");
    expect(r.err).not.toContain("design not implemented");
  });

  it("never reads stdin: closed stdin cannot hang a command", () => {
    const { file } = tmpConfig();
    expect(qa(args("extract", file, "stdin-check"), KEYS).code).not.toBeNull();
  });
});
