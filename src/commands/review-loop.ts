import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CaseReviewFile } from "../contracts/case-review";
import { makeOpenAiTransport } from "../llm/openai-transport";
import type { LlmTransport } from "../llm/structured";
import { runDesign } from "./design";
import { MAX_REVISIONS, runReview } from "./review";
import type { CommandContext, Stage } from "./types";

function hasRevise(runDir: string): boolean {
  const f = path.join(runDir, "case-review.json");
  if (!existsSync(f)) return false;
  return CaseReviewFile.parse(JSON.parse(readFileSync(f, "utf8"))).entries.some((e) => e.verdict === "revise");
}

/**
 * Review, then up to MAX_REVISIONS rounds of (design --revise, review). The review after the last
 * revision turns any case still marked revise into drop, so the loop always terminates.
 */
export async function runReviewLoop(ctx: CommandContext, deps: { transport: LlmTransport }): Promise<number> {
  for (let round = 1; round <= MAX_REVISIONS + 1; round++) {
    const code = await runReview(ctx, deps);
    if (code !== 0) return code;
    if (round > MAX_REVISIONS || !hasRevise(ctx.runDir)) return 0;
    const designCode = await runDesign({ ...ctx, args: { ...ctx.args, revise: true } }, deps);
    if (designCode !== 0) return designCode;
  }
  return 0;
}

/** The review stage as used by `qa all`. */
export const reviewLoopStage: Stage = {
  name: "review",
  needs: ["OPENAI_API_KEY"],
  requires: ["cases.json"],
  createsRunDir: false,
  run: (ctx) =>
    runReviewLoop(ctx, {
      transport: makeOpenAiTransport({ apiKey: ctx.env.OPENAI_API_KEY!, baseUrl: ctx.config.llm.baseUrl, model: ctx.config.llm.model }),
    }),
};
