import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "../config";
import { Acceptance } from "../contracts/acceptance";
import { CasesFile } from "../contracts/cases";
import { SourcesFile } from "../contracts/sources";
import { makeOpenAiTransport } from "../llm/openai-transport";
import type { LlmTransport } from "../llm/structured";
import { reviewCases } from "../review/review";
import { writeArtifact } from "../run-dir";
import type { CommandContext, Stage } from "./types";

export const MAX_REVISIONS = 2;

function readJson<T>(dir: string, name: string, schema: { parse(x: unknown): T }): T {
  const file = path.join(dir, name);
  if (!existsSync(file)) throw new ConfigError(`review: required input missing: ${file}`);
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    throw new ConfigError(`review: ${file} is not valid: ${(e as Error).message.split("\n")[0]}`);
  }
}

export async function runReview(ctx: CommandContext, deps: { transport: LlmTransport }): Promise<number> {
  try {
    const cases = readJson(ctx.runDir, "cases.json", CasesFile).cases;
    const acceptance = readJson(ctx.runDir, "acceptance.json", Acceptance);
    const sources = readJson(ctx.runDir, "sources.json", SourcesFile).sources;
    const round = readdirSync(ctx.runDir).filter((f) => /^case-review\.v\d+\.json$/.test(f)).length + 1;

    const { entries, reviewed } = await reviewCases({
      transport: deps.transport, runbook: ctx.runbook, cases, acceptance, sources,
      maxRetries: ctx.config.llm.maxRetries, round, maxRevisions: MAX_REVISIONS,
    });
    writeArtifact(ctx.runDir, `case-review.v${round}.json`, { entries }, { force: ctx.force });
    // The unversioned files always hold the latest round.
    writeArtifact(ctx.runDir, "case-review.json", { entries }, { force: true });
    writeArtifact(ctx.runDir, "cases.reviewed.json", { cases: reviewed }, { force: true });

    const n = (v: string) => entries.filter((e) => e.verdict === v).length;
    console.log(`review (round ${round}): keep ${n("keep")}, drop ${n("drop")}, revise ${n("revise")}${n("revise") ? " (run qa design --revise, then qa review again)" : ""}`);
    return 0;
  } catch (e) {
    const code = (e as { exitCode?: unknown }).exitCode;
    if (typeof code !== "number") throw e;
    console.error((e as Error).message);
    return code;
  }
}

export const reviewStage: Stage = {
  name: "review",
  needs: ["OPENAI_API_KEY"],
  requires: ["cases.json"],
  createsRunDir: false,
  run: (ctx) =>
    runReview(ctx, {
      transport: makeOpenAiTransport({ apiKey: ctx.env.OPENAI_API_KEY!, baseUrl: ctx.config.llm.baseUrl, model: ctx.config.llm.model }),
    }),
};
