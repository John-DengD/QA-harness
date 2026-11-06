import type { TestInfo } from "@playwright/test";

import { parseRuntimeConfig } from "../../../src/config";
import { buildAttemptRunId } from "../../../src/tools/identity";
import { StageTracker } from "../../../src/tools/stage-tracker";

export const caseRuntime = (testInfo: TestInfo, caseId: string) => {
  const runtime = parseRuntimeConfig(process.env);
  const baseRunId = (
    process.env.E2E_RUN_ID ?? `local-${Date.now()}-${testInfo.workerIndex}`
  ).replace(/[^a-zA-Z0-9_-]/g, "-");
  const runId = buildAttemptRunId(`${baseRunId}-${caseId}`, testInfo.retry);
  const stages = new StageTracker(testInfo.outputPath("stages.json"), {
    caseId,
    tag: `@case:${caseId}`,
  });
  return { runId, runtime, stages };
};
