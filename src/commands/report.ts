import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "../config";
import { Acceptance } from "../contracts/acceptance";
import { CaseReviewFile } from "../contracts/case-review";
import { CasesFile } from "../contracts/cases";
import { Env } from "../contracts/env";
import { ExtractReport } from "../contracts/extract-report";
import { GeneratorsFile } from "../contracts/generators";
import { CaseResult } from "../contracts/result";
import { RunSummary } from "../contracts/run-summary";
import { buildReport, reportExitCode } from "../report/report";
import { writeFileGuarded } from "../run-dir";
import type { CommandContext, Stage } from "./types";

function readJson<T>(dir: string, name: string, schema: { parse(x: unknown): T }, optional = false): T | null {
  const file = path.join(dir, name);
  if (!existsSync(file)) {
    if (optional) return null;
    throw new ConfigError(`report: required input missing: ${file}`);
  }
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    throw new ConfigError(`report: ${file} is not valid: ${(e as Error).message.split("\n")[0]}`);
  }
}

export async function runReport(ctx: CommandContext): Promise<number> {
  try {
    const d = ctx.runDir;
    const resultsDir = path.join(d, "results");
    const results = existsSync(resultsDir)
      ? readdirSync(resultsDir).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(resultsDir, f, CaseResult)!)
      : [];
    const input = {
      feature: path.basename(path.dirname(path.dirname(d))),
      runId: path.basename(d),
      env: readJson(d, "env.json", Env)!,
      acceptance: readJson(d, "acceptance.json", Acceptance)!,
      cases: readJson(d, "cases.json", CasesFile)!.cases,
      review: readJson(d, "case-review.json", CaseReviewFile)!.entries,
      results,
      summary: readJson(d, "run-summary.json", RunSummary, true),
      extractReport: readJson(d, "extract-report.json", ExtractReport, true),
      generators: readJson(d, "generators.json", GeneratorsFile, true),
    };
    writeFileGuarded(d, "report.md", buildReport(input), { force: ctx.force });
    const code = reportExitCode(input);
    console.log(`report: ${path.join(d, "report.md")} (exit code ${code})`);
    return code;
  } catch (e) {
    const code = (e as { exitCode?: unknown }).exitCode;
    if (typeof code !== "number") throw e;
    console.error((e as Error).message);
    return code;
  }
}

export const reportStage: Stage = {
  name: "report",
  needs: [],
  requires: ["results"],
  createsRunDir: false,
  run: (ctx) => runReport(ctx),
};
