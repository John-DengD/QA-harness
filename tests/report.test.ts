import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReport } from "../src/commands/report";
import type { CommandContext } from "../src/commands/types";
import { buildReport } from "../src/report/report";

const kase = (id: string, title: string, generator = "G1") => ({ id, title, generator, type: "happy", expected: { text: `expect ${id}`, sourceRef: "linear:DEV-1", anchor: "a" }, preconditions: ["signed in"], risk: "r", testability: { state: "ready" } }) as never;
const input = () => ({
  feature: "DEV-1", runId: "r1",
  env: { kind: "pr-sandbox", baseUrl: "https://dash.example.test", prNumber: 9, headSha: "abc1234" } as never,
  acceptance: { atoms: [{ id: "A01", text: "banner", sourceRef: "linear:DEV-1", anchor: "a" }, { id: "A02", text: "toast", sourceRef: "linear:DEV-1", anchor: "b" }] },
  cases: [kase("C01", "Pass case"), kase("C02", "Failing case"), kase("C03", "Generated case"), kase("C04", "Dropped case"), kase("C05", "Not automated"), kase("C06", "Trimmed", "G6")],
  review: [
    { caseId: "C01", verdict: "keep", reason: "ok" }, { caseId: "C02", verdict: "keep", reason: "ok" }, { caseId: "C03", verdict: "keep", reason: "ok" },
    { caseId: "C04", verdict: "drop", reason: "duplicates C01" }, { caseId: "C05", verdict: "keep", reason: "ok" }, { caseId: "C06", verdict: "keep", reason: "ok" },
  ] as never,
  results: [
    { caseId: "C01", verdict: "Pass", generated: false, evidenceDir: "evidence/C01" },
    { caseId: "C02", verdict: "ProductFail", generated: false, evidenceDir: "evidence/C02", notes: "expect(locator).toHaveText failed" },
    { caseId: "C03", verdict: "Inconclusive", generated: true, evidenceDir: "evidence/C03", notes: "generated script assertion failed" },
  ] as never,
  summary: { executed: ["C01", "C02", "C03"], notAutomated: [{ caseId: "C05", reason: "generation failed: TS2304" }], skipped: [], blocked: [], startedAt: "2026-11-06T10:00:00.000Z", finishedAt: "2026-11-06T10:05:00.000Z" },
  extractReport: { dropped: [{ text: "x", sourceRef: "linear:DEV-1", anchor: "not in source", reason: "anchor not found in source" }], sources: [{ ref: "linear:DEV-1", title: "Banner" }] },
  generators: { generators: [], candidatePool: [{ mechanism: "no source mech", why: "unknown source s" }], trimmed: [{ title: "Trimmed", reason: "over budget" }] } as never,
});

describe("buildReport", () => {
  it("contains every part of the run", () => {
    const md = buildReport(input());
    for (const s of [
      "DEV-1", "r1", "pr-sandbox", "abc1234",
      "Pass case", "Failing case", "ProductFail", "Inconclusive", "generated",
      "expect C02", "signed in", "evidence/C02", "expect(locator).toHaveText failed",
      "Dropped case", "duplicates C01",
      "Not automated", "generation failed: TS2304",
      "over budget", "no source mech", "anchor not found in source",
    ]) expect(md, s).toContain(s);
  });
  it("shows coverage numbers from atoms to passed cases", () => {
    const md = buildReport(input());
    expect(md).toMatch(/验收点[^\n]*2/);
    expect(md).toMatch(/已执行[^\n]*3/);
    expect(md).toMatch(/通过[^\n]*1/);
  });
  it("contains the independence statement exactly once and never claims independent post-run review", () => {
    const md = buildReport(input());
    const statement = "执行前的 case 清单经过一次独立审核;执行后的结论没有经过独立复核。";
    expect(md.split(statement)).toHaveLength(2);
    expect(md).not.toContain("已独立复核");
  });
  it("states the exit-code meaning of the run", () => {
    expect(buildReport(input())).toMatch(/退出码[^\n]*10/);
  });
  it("still renders without a run summary, extract report or generators", () => {
    const i = { ...input(), summary: null, extractReport: null, generators: null };
    expect(() => buildReport(i)).not.toThrow();
  });
  it("a fully passing run reports exit code 0", () => {
    const i = { ...input(), cases: [kase("C01", "Only")], review: [{ caseId: "C01", verdict: "keep", reason: "ok" }] as never, results: [{ caseId: "C01", verdict: "Pass", generated: false, evidenceDir: "e" }] as never, summary: null, extractReport: null, generators: null };
    expect(buildReport(i)).toMatch(/退出码[^\n]*0/);
  });
});

function setup() {
  const runDir = mkdtempSync(path.join(tmpdir(), "qa-rep-"));
  const feature = "DEV-1";
  const dir = path.join(runDir, feature, "runs", "r1");
  mkdirSync(path.join(dir, "results"), { recursive: true });
  const i = input();
  const w = (n: string, d: unknown) => writeFileSync(path.join(dir, n), JSON.stringify(d));
  w("env.json", i.env); w("acceptance.json", i.acceptance); w("cases.json", { cases: i.cases }); w("case-review.json", { entries: i.review });
  for (const r of i.results as unknown as { caseId: string }[]) w(`results/${r.caseId}.json`, r);
  w("run-summary.json", i.summary); w("extract-report.json", i.extractReport); w("generators.json", i.generators);
  const c: CommandContext = { config: {} as never, runbook: {} as never, runDir: dir, env: {}, force: false, args: {} };
  return { c, dir };
}

describe("runReport", () => {
  it("writes report.md and returns the run's exit code", async () => {
    const x = setup();
    expect(await runReport(x.c)).toBe(10);
    expect(readFileSync(path.join(x.dir, "report.md"), "utf8")).toContain("Failing case");
  });
  it("refuses to overwrite report.md without --force", async () => {
    const x = setup();
    await runReport(x.c);
    const errs: string[] = []; const spy = console.error; console.error = (m: string) => errs.push(String(m));
    try { expect(await runReport(x.c)).toBe(2); } finally { console.error = spy; }
    expect(errs.join()).toContain("report.md");
    x.c.force = true;
    expect(await runReport(x.c)).toBe(10);
  });
});
