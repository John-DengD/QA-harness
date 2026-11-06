import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const EX = path.resolve(__dirname, "../executor");
const pkg = () => JSON.parse(readFileSync(path.join(EX, "package.json"), "utf8"));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

describe("migrated executor", () => {
  it("has the full Action catalog (191) and the 18 action files", () => {
    const catalog = JSON.parse(readFileSync(path.join(EX, "src/tools/action-catalog.json"), "utf8"));
    expect(Object.keys(catalog)).toHaveLength(191);
    expect(readdirSync(path.join(EX, "src/actions")).filter((f) => f.endsWith(".ts"))).toHaveLength(18);
  });

  it("carries the run gate the Playwright runner requires", () => {
    for (const f of ["src/loop/state.ts", "src/loop/run-gate.ts", "src/loop/run-root.ts", "scripts/run-e2b-playwright.ts", "scripts/loop-state.ts"]) {
      expect(existsSync(path.join(EX, f)), f).toBe(true);
    }
  });

  it("copies no credential files", () => {
    const bad = walk(EX).filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".example"));
    expect(bad).toEqual([]);
  });

  it("does not expose non-goal entry points as package scripts", () => {
    const scripts = Object.keys(pkg().scripts);
    for (const s of ["computer-use", "explore:case", "qa:checker", "omission:hook", "human:review"]) {
      expect(scripts, s).not.toContain(s);
    }
    expect(scripts).toEqual(expect.arrayContaining(["typecheck", "test:unit", "test:list", "action:select", "loop:state"]));
  });

  it("excludes the report app, computer-use and exploration code", () => {
    for (const d of ["apps", "midscene_run", "playwright-report", "src/computer-use", "src/exploration"]) {
      expect(existsSync(path.join(EX, d)), d).toBe(false);
    }
  });

  it("records where it came from", () => {
    const m = readFileSync(path.join(EX, "MIGRATION.md"), "utf8");
    expect(m).toContain("a6c5417");
    expect(m).toContain("uncommitted");
  });
});
