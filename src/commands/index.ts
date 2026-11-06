import { existsSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "../config";
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

/** qa all: run every stage in order, stop at the first non-zero exit. */
export async function executeAll(ctx: CommandContext): Promise<number> {
  for (const stage of STAGES) {
    const code = await executeStage(stage, ctx);
    if (code !== 0) return code;
  }
  return 0;
}
