import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvironments } from "../src/environments";
import { loadRunbook, RunbookError } from "../src/runbook";

const REAL = path.resolve(__dirname, "../runbook");

function copyWith(envJson: string | null) {
  const root = mkdtempSync(path.join(tmpdir(), "qa-envs-"));
  cpSync(REAL, root, { recursive: true });
  const f = path.join(root, "environments.json");
  if (envJson === null) { try { require("node:fs").rmSync(f); } catch {} } else writeFileSync(f, envJson);
  return root;
}

describe("loadEnvironments", () => {
  it("loads the real runbook/environments.json", () => {
    const env = loadEnvironments(loadRunbook(REAL));
    expect(env.prSandbox.botAuthor).toBe("github-actions");
    expect(env.prSandbox.status.ready).toBe("Sandbox ready");
  });
  it("names the field path when a field is missing", () => {
    const bad = JSON.parse(require("node:fs").readFileSync(path.join(REAL, "environments.json"), "utf8"));
    delete bad.prSandbox.marker;
    const root = copyWith(JSON.stringify(bad));
    expect(() => loadEnvironments({ root, modules: [], text: (r: string) => require("node:fs").readFileSync(path.join(root, r), "utf8") })).toThrow(/prSandbox\.marker/);
  });
  it("rejects a footer pattern without exactly one capture group", () => {
    const bad = JSON.parse(require("node:fs").readFileSync(path.join(REAL, "environments.json"), "utf8"));
    bad.prSandbox.footerShaPattern = "Updated.*";
    const root = copyWith(JSON.stringify(bad));
    expect(() => loadEnvironments({ root, modules: [], text: (r: string) => require("node:fs").readFileSync(path.join(root, r), "utf8") })).toThrow(/footerShaPattern/);
  });
  it("makes the Runbook invalid when the file is absent", () => {
    expect(() => loadRunbook(copyWith(null))).toThrow(/environments\.json/);
    expect(() => loadRunbook(copyWith(null))).toThrow(RunbookError);
  });
});
