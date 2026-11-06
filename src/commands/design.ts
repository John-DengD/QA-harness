import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "../config";
import { Acceptance } from "../contracts/acceptance";
import { CaseReviewFile } from "../contracts/case-review";
import { CasesFile } from "../contracts/cases";
import { ChangeModel } from "../contracts/change-model";
import { SourcesFile } from "../contracts/sources";
import { designCases, reviseCases } from "../design/design";
import { makeOpenAiTransport } from "../llm/openai-transport";
import type { LlmTransport } from "../llm/structured";
import { writeArtifact } from "../run-dir";
import type { CommandContext, Stage } from "./types";

function readJson<T>(dir: string, name: string, schema: { parse(x: unknown): T }, optional = false): T | null {
  const file = path.join(dir, name);
  if (!existsSync(file)) {
    if (optional) return null;
    throw new ConfigError(`design: required input missing: ${file}`);
  }
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    throw new ConfigError(`design: ${file} is not valid: ${(e as Error).message.split("\n")[0]}`);
  }
}

const versionCount = (dir: string, re: RegExp) => readdirSync(dir).filter((f) => re.test(f)).length;

export async function runDesign(ctx: CommandContext, deps: { transport: LlmTransport }): Promise<number> {
  try {
    const sources = readJson(ctx.runDir, "sources.json", SourcesFile)!.sources;
    const acceptance = readJson(ctx.runDir, "acceptance.json", Acceptance)!;

    if (ctx.args.revise) {
      const current = readJson(ctx.runDir, "cases.json", CasesFile)!.cases;
      const review = readJson(ctx.runDir, "case-review.json", CaseReviewFile)!;
      const feedback = review.entries.filter((e) => e.verdict === "revise").map((e) => ({ caseId: e.caseId, reason: e.reason }));
      if (feedback.length === 0) {
        console.log("design --revise: nothing marked revise");
        return 0;
      }
      const revised = await reviseCases({
        transport: deps.transport, runbook: ctx.runbook, cases: current, feedback, sources, acceptance, maxRetries: ctx.config.llm.maxRetries,
      });
      const byId = new Map(revised.map((c) => [c.id, c]));
      const next = { cases: current.map((c) => byId.get(c.id) ?? c) };
      const n = versionCount(ctx.runDir, /^cases\.v\d+\.json$/) + 1;
      writeArtifact(ctx.runDir, `cases.v${n}.json`, next, { force: ctx.force });
      writeArtifact(ctx.runDir, "cases.json", next, { force: true }); // cases.json always points at the latest version (spec §4.11)
      console.log(`design --revise: revised ${feedback.length} case(s) -> cases.v${n}.json`);
      return 0;
    }

    const changeModel = readJson(ctx.runDir, "change-model.json", ChangeModel, true);
    const result = await designCases({
      transport: deps.transport, runbook: ctx.runbook, acceptance, changeModel, sources,
      maxCases: ctx.config.design.maxCases, maxRetries: ctx.config.llm.maxRetries,
    });
    writeArtifact(ctx.runDir, "generators.json", result.generators, { force: ctx.force });
    if (result.cases.length === 0) {
      console.error(`design: no plannable case (${result.generators.candidatePool.length} candidate(s) lacked an authoritative source)`);
      return 2;
    }
    writeArtifact(ctx.runDir, "cases.v1.json", { cases: result.cases }, { force: ctx.force });
    writeArtifact(ctx.runDir, "cases.json", { cases: result.cases }, { force: ctx.force });
    console.log(`design: ${result.cases.length} case(s), ${result.generators.trimmed.length} trimmed, ${result.generators.candidatePool.length} in candidate pool`);
    return 0;
  } catch (e) {
    const code = (e as { exitCode?: unknown }).exitCode;
    if (typeof code !== "number") throw e;
    console.error((e as Error).message);
    return code;
  }
}

export const designStage: Stage = {
  name: "design",
  needs: ["OPENAI_API_KEY"],
  requires: ["acceptance.json"],
  createsRunDir: false,
  run: (ctx) =>
    runDesign(ctx, {
      transport: makeOpenAiTransport({ apiKey: ctx.env.OPENAI_API_KEY!, baseUrl: ctx.config.llm.baseUrl, model: ctx.config.llm.model }),
    }),
};
