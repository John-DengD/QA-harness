import path from "node:path";

import { resolveQaRoot } from "../tools/action-health";
import { inspectRun, type RunPhase, type RunRecord } from "./state";

const EXECUTABLE_PHASES: readonly RunPhase[] = ["planned", "executing", "changes_requested"];

/**
 * Refuses to execute a Case unless its run is registered in `QA_ROOT/.qa-loop`.
 * Without the registration the next run cannot find this run's gaps, so the
 * cross-run loop silently breaks. `QA_LOOP_GATE=smoke` is reserved for the
 * shared-browser smoke tool, which verifies infrastructure rather than a QA run.
 */
export async function assertRegisteredRun(
  evidencePath: string,
  env: Record<string, string | undefined> = process.env,
): Promise<RunRecord | null> {
  if (env.QA_LOOP_GATE === "smoke") return null;
  const runRoot = findRunRoot(path.resolve(evidencePath));
  if (!runRoot) {
    throw new Error(
      `Evidence must live under QA_ROOT/[<surface>/]<feature>/runs/<runId>/: ${evidencePath}. Create the run directory and register it first.`
    );
  }
  const runId = path.basename(runRoot);
  const qaRoot = resolveQaRoot(runRoot);
  const hint = `Register it before executing any Case: pnpm loop:state -- init --qa-root <QA_ROOT> --run-id ${runId} --run-root [<surface>/]<feature>/runs/${runId} ... (QA_ROOT: pnpm qa-env:root) (see references/loop-state.md)`;
  if (!qaRoot) throw new Error(`Run ${runId} is not registered in .qa-loop. ${hint}`);
  let run: RunRecord;
  try {
    run = await inspectRun(qaRoot, runId);
  } catch {
    throw new Error(`Run ${runId} is not registered in ${path.join(qaRoot, ".qa-loop")}. ${hint}`);
  }
  if (path.resolve(qaRoot, run.runRoot) !== runRoot) {
    throw new Error(`Run ${runId} is registered with runRoot ${run.runRoot}, not ${path.relative(qaRoot, runRoot)}`);
  }
  if (run.lanes) {
    throw new Error(
      `Run ${runId} is a merged run (lanes: ${run.lanes.join(", ")}) and executes no Case; execute in a lane run ` +
      `(loop:state -- init --lane-of ${runId} --lane <label> ...), then merge with qa:checker -- merge`
    );
  }
  if (!EXECUTABLE_PHASES.includes(run.phase)) {
    throw new Error(
      `Run ${runId} is in phase ${run.phase}; new Case execution needs a new run or a changes_requested checkpoint`
    );
  }
  return run;
}

function findRunRoot(start: string): string | null {
  let current = start;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    if (path.basename(parent) === "runs") return current;
    current = parent;
  }
}

/**
 * Printed by record-start (it never moves the phase itself, so the omission plan
 * can still be frozen while planned): the checkpoint the run needs before it can
 * reach awaiting_review. Null when nothing is due.
 */
export function executionPhaseHint(run: RunRecord | null): string | null {
  if (!run || run.phase !== "planned") return null;
  return `Run ${run.runId} is still planned. Once the omission plan is frozen (omission:hook freeze), move it on: ` +
    `pnpm loop:state checkpoint --run-id ${run.runId} --executor-id ${run.executorId} --phase executing ` +
    "(awaiting_review is reachable only from executing).";
}
