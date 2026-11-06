import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "../config";
import { CasesFile } from "../contracts/cases";
import { Env } from "../contracts/env";
import { realExec } from "../exec";
import { makeOpenAiTransport } from "../llm/openai-transport";
import type { LlmTransport } from "../llm/structured";
import { writeArtifact } from "../run-dir";
import { runCases } from "../run/run-cases";
import { makePlaywrightRunner, makeRegistry, makeSandboxDriver, makeScriptValidator } from "../run/real-deps";
import type { RunDeps } from "../run/types";
import type { CommandContext, Stage } from "./types";

const SECRETISH = /KEY|SECRET|TOKEN|PASSWORD/i;

function readJson<T>(dir: string, name: string, schema: { parse(x: unknown): T }): T {
  const file = path.join(dir, name);
  if (!existsSync(file)) throw new ConfigError(`run: required input missing: ${file}`);
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    throw new ConfigError(`run: ${file} is not valid: ${(e as Error).message.split("\n")[0]}`);
  }
}

export async function runRun(ctx: CommandContext, deps: { runDeps: RunDeps; transport: LlmTransport }): Promise<number> {
  try {
    const cases = readJson(ctx.runDir, "cases.reviewed.json", CasesFile).cases;
    const env = readJson(ctx.runDir, "env.json", Env);
    const runId = path.basename(ctx.runDir);
    const feature = path.basename(path.dirname(path.dirname(ctx.runDir)));
    const secrets = Object.entries(ctx.env).filter(([k, v]) => SECRETISH.test(k) && v).map(([, v]) => v!);

    const { results, summary, exitCode } = await runCases({
      cases, env, runbook: ctx.runbook, runDir: ctx.runDir, runId, feature, secrets, force: ctx.force,
      deps: deps.runDeps, transport: deps.transport,
      limits: { caseTimeoutMs: ctx.config.run.caseTimeoutMs, totalTimeoutMs: ctx.config.run.totalTimeoutMs, maxRetries: ctx.config.llm.maxRetries },
    });
    writeArtifact(ctx.runDir, "run-summary.json", summary, { force: ctx.force });
    const n = (v: string) => results.filter((r) => r.verdict === v).length;
    console.log(
      `run: ${results.length} result(s): Pass ${n("Pass")}, ProductFail ${n("ProductFail")}, Blocked ${n("Blocked")}, Inconclusive ${n("Inconclusive")}, ` +
        `Automation failure ${n("Automation failure")}, NotApplicable ${n("NotApplicable")}; not automated ${summary.notAutomated.length}, skipped ${summary.skipped.length}`,
    );
    return exitCode;
  } catch (e) {
    const code = (e as { exitCode?: unknown }).exitCode;
    if (typeof code !== "number") throw e;
    console.error((e as Error).message);
    return code;
  }
}

export const runStage: Stage = {
  name: "run",
  needs: ["E2B_API_KEY", "OPENAI_API_KEY"],
  requires: ["cases.reviewed.json"],
  createsRunDir: false,
  run: (ctx) => {
    const executorRoot = ctx.config.executor.root;
    const exec = realExec;
    const qaRoot = ctx.config.runRoot;
    return runRun(ctx, {
      transport: makeOpenAiTransport({ apiKey: ctx.env.OPENAI_API_KEY!, baseUrl: ctx.config.llm.baseUrl, model: ctx.config.llm.model }),
      runDeps: {
        sandbox: makeSandboxDriver({ executorRoot, qaRoot, env: ctx.env, exec }),
        playwright: makePlaywrightRunner({ executorRoot, qaRoot, env: ctx.env, exec }),
        registry: makeRegistry({ executorRoot, qaRoot, env: ctx.env, exec }),
        validate: makeScriptValidator({ executorRoot, qaRoot, env: ctx.env, exec }),
      },
    });
  },
};
