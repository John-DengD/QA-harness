import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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
