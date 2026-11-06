import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "../src/config";
import { runDoctor } from "../src/doctor";

const base: Config = {
  configDir: "/x",
  runbook: { path: path.resolve(__dirname, "../runbook") },
  runRoot: "/x/runs",
  executor: { root: "/x/executor" },
  llm: { model: "m", baseUrl: "https://api.openai.com/v1", maxRetries: 2 },
  design: { maxCases: 12 },
  run: { caseTimeoutMs: 1, totalTimeoutMs: 2 },
};

describe("runDoctor", () => {
  it("is ok with no secrets needed", () => {
    expect(runDoctor(base, [], {})).toEqual({ ok: true, problems: [] });
  });
  it("reports a missing secret only when the command needs it", () => {
    const r = runDoctor(base, ["OPENAI_API_KEY"], { OPENAI_API_KEY: "" });
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain("OPENAI_API_KEY");
  });
  it("reports a bad runbook path as a problem, not an exception", () => {
    const r = runDoctor({ ...base, runbook: { path: "/nonexistent" } }, [], {});
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("/nonexistent");
  });
  it("reports an invalid environments.json with the field path", () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-doc-"));
    cpSync(path.resolve(__dirname, "../runbook"), root, { recursive: true });
    writeFileSync(path.join(root, "environments.json"), JSON.stringify({ prSandbox: { botAuthor: "x" } }));
    const r = runDoctor({ ...base, runbook: { path: root } }, [], {});
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain("prSandbox.marker");
  });
});
