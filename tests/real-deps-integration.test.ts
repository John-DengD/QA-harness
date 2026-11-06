import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { realExec } from "../src/exec";
import { makeScriptValidator } from "../src/run/real-deps";

const ROOT = path.resolve(__dirname, "..");
const EXECUTOR = path.join(ROOT, "executor");
const have = existsSync(path.join(EXECUTOR, "node_modules", ".bin", "tsc")) && existsSync(path.join(EXECUTOR, "node_modules", ".bin", "playwright"));
const VALID = `import { test, expect } from "./fixtures";\ntest("x", async () => { expect(1).toBe(1); });\n`;
const BROKEN = `import { test } from "./fixtures";\ntest("x", async () => { const n: number = "not a number"; });\n`;

// Real validator against the real executor: catches what a fake exec cannot (module format, resolution, shared tsconfig).
describe.skipIf(!have)("script validator against the real executor", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const mkdirUnder = (base: string) => { mkdirSync(base, { recursive: true }); const d = mkdtempSync(path.join(base, "t-")); dirs.push(d); return path.join(d, "generated-specs"); };
  const validate = () => makeScriptValidator({ executorRoot: EXECUTOR, qaRoot: "/tmp/qa", env: { ...process.env }, exec: realExec });
  const spec = (dir: string, name: string, code: string) => { mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); writeFileSync(f, code); return f; };

  for (const [label, base] of [["inside the harness repo (type: module)", path.join(ROOT, "runs", ".itest")], ["outside any package", path.join(tmpdir(), "qa-itest")]] as const) {
    it(`accepts a valid spec ${label}`, async () => {
      const dir = mkdirUnder(base);
      const r = await validate()(spec(dir, "C01.spec.ts", VALID));
      expect(r.output).toBe("");
      expect(r.ok).toBe(true);
    }, 120_000);
  }

  it("one broken spec does not poison validation of another in the same directory", async () => {
    const dir = mkdirUnder(path.join(tmpdir(), "qa-itest"));
    const broken = await validate()(spec(dir, "C03.spec.ts", BROKEN));
    expect(broken.ok).toBe(false);
    expect(broken.output).toMatch(/TS2322|not assignable/);
    const good = await validate()(spec(dir, "C02.spec.ts", VALID));
    expect(good.ok).toBe(true);
  }, 120_000);
});
