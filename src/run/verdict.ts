import type { Verdict } from "../contracts/result";
import { ExitCode } from "../exit-codes";
import type { ModuleMeta } from "../runbook";

export type FailureKind = "assertion" | "automation";
export type Classification = { outcome: "passed" } | { outcome: "failed"; kind: FailureKind; message: string };

type PwResult = { status?: string; error?: { message?: string } };

function collectResults(node: any, out: PwResult[]): void {
  for (const suite of node?.suites ?? []) collectResults(suite, out);
  for (const spec of node?.specs ?? []) {
    for (const test of spec?.tests ?? []) for (const r of test?.results ?? []) out.push(r);
  }
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const ASSERTION = /expect\([^)]*\)\.(?:not\.)?to[A-Z]\w*/;
const NOT_ASSERTION = /Test timeout of|Target (?:page|context|browser)[^\n]* (?:has been )?closed|locator\.\w+: Timeout/;

/** Assertion failure = a failed expect(...).toXxx matcher. Everything else is an automation failure (spec §4.10). */
export function classifyPlaywrightReport(report: unknown, exitCode: number, timedOut: boolean): Classification {
  if (timedOut) return { outcome: "failed", kind: "automation", message: "the case exceeded its time limit and was stopped" };
  const results: PwResult[] = [];
  collectResults(report, results);
  if (results.length === 0) {
    return { outcome: "failed", kind: "automation", message: `no Playwright result was produced (exit code ${exitCode})` };
  }
  const failed = results.filter((r) => r.status === "failed" || r.status === "timedOut" || r.status === "interrupted");
  if (failed.length === 0) {
    if (exitCode !== 0) return { outcome: "failed", kind: "automation", message: `Playwright exited with ${exitCode} although every result passed` };
    if (results.every((r) => r.status === "skipped")) return { outcome: "failed", kind: "automation", message: "every test was skipped" };
    return { outcome: "passed" };
  }
  const message = stripAnsi(failed.map((r) => r.error?.message ?? r.status ?? "failed").join("\n"));
  const isAssertion = failed.every((r) => r.status === "failed") && ASSERTION.test(message) && !NOT_ASSERTION.test(message);
  return { outcome: "failed", kind: isAssertion ? "assertion" : "automation", message: message.slice(0, 2000) };
}

export function expectedSourceKind(sourceRef: string, runbook: { modules: ModuleMeta[] }): "authoritative" | "weak" {
  if (/^(linear|file|pr|goal):/.test(sourceRef)) return "authoritative";
  const m = /^runbook:(.+)$/.exec(sourceRef);
  if (m) {
    const mod = runbook.modules.find((x) => x.path === m[1]);
    return mod?.status === "active" ? "authoritative" : "weak";
  }
  return "weak";
}

export function mapVerdict(input: {
  classification: Classification;
  sourceKind: "authoritative" | "weak";
  generated: boolean;
  recordingOk: boolean;
}): { verdict: Verdict; notes?: string } {
  if (!input.recordingOk) {
    return { verdict: "Automation failure", notes: "the case recording is missing or empty; the result cannot be counted" };
  }
  const c = input.classification;
  if (c.outcome === "passed") return { verdict: "Pass" };
  if (c.kind === "automation") return { verdict: "Automation failure", notes: c.message };
  if (input.generated) {
    return { verdict: "Inconclusive", notes: `assertion failed in a generated script (cannot tell a product defect from a wrong script): ${c.message}` };
  }
  if (input.sourceKind === "weak") {
    return { verdict: "Inconclusive", notes: `assertion failed but its Expected comes only from a pilot/draft Runbook module: ${c.message}` };
  }
  return { verdict: "ProductFail", notes: c.message };
}

export function summaryExitCode(results: { verdict: Verdict }[], extra: { notAutomated: number; skipped: number }): number {
  if (results.some((r) => r.verdict === "ProductFail")) return ExitCode.PRODUCT_FAIL;
  const incomplete =
    results.some((r) => r.verdict === "Blocked" || r.verdict === "Inconclusive" || r.verdict === "Automation failure") ||
    extra.notAutomated > 0 ||
    extra.skipped > 0;
  return incomplete ? ExitCode.INCOMPLETE : ExitCode.OK;
}
