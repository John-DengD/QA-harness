import { existsSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "../config";
import { combineExit, ExitCode } from "../exit-codes";
import { designStage } from "./design";
import { extractStage } from "./extract";
import { reportStage } from "./report";
import { reviewStage } from "./review";
import { runStage } from "./run";
import type { CommandContext, Stage } from "./types";

export const STAGES: Stage[] = [extractStage, designStage, reviewStage, runStage, reportStage];

/** Checks the stage's input artifacts, then runs its body. */
export async function executeStage(stage: Stage, ctx: CommandContext): Promise<number> {
  for (const rel of stage.requires) {
    if (!existsSync(path.join(ctx.runDir, rel))) {
      throw new ConfigError(`${stage.name}: required input missing: ${path.join(ctx.runDir, rel)}`);
    }
  }
  return stage.run(ctx);
}

/**
 * qa all: run every stage in order. 10 (ProductFail) and 20 (incomplete) are results of a finished
 * run, so the report still gets built; anything else non-zero (2, 3, the placeholder 1) aborts.
 * The exit code is the lowest non-zero code seen (spec §7).
 */
export async function executeAll(ctx: CommandContext, stages: Stage[] = STAGES): Promise<number> {
  const codes: number[] = [];
  for (const stage of stages) {
    const code = await executeStage(stage, ctx);
    codes.push(code);
    if (code !== 0 && code !== ExitCode.PRODUCT_FAIL && code !== ExitCode.INCOMPLETE) break;
  }
  return combineExit(codes);
}
