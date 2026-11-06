import { appendFile } from "node:fs/promises";

import { runReleaseGate, type ReleaseWorkflowRun } from "../src/tools/release-gate";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

// Advisory by default: a failed staging journey reports, it does not hold the
// release. Set E2E_GATE_BLOCKING=true to turn this step into a hard gate.
const blocking = process.env.E2E_GATE_BLOCKING === "true";
const correlationId = required("E2E_CORRELATION_ID");
const reportAppUrl = required("E2E_REPORT_APP_URL").replace(/\/+$/, "");
const reportUrl = reportAppUrl;

let result: ReleaseWorkflowRun | undefined;
let failure: string | undefined;

try {
  result = await runReleaseGate(
    {
      baseUrl:
        process.env.E2E_BASE_URL ?? "https://app-staging.hellyeahai.com",
      commitSha: required("E2E_COMMIT_SHA"),
      correlationId,
      release: required("E2E_RELEASE"),
      repository:
        process.env.E2E_REPOSITORY ?? "finalroundai/hy_ui_autotest",
      sourceRepository:
        process.env.GITHUB_REPOSITORY ?? "finalroundai/hellyeah-v2",
      sourceRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
      sourceRunId: process.env.GITHUB_RUN_ID ?? correlationId,
      token: required("E2E_REPOSITORY_TOKEN"),
      upstreamRunUrl: required("E2E_UPSTREAM_RUN_URL"),
    },
    { requireSuccess: blocking }
  );
} catch (error) {
  if (blocking) throw error;
  failure = error instanceof Error ? error.message : String(error);
}

const conclusion = result?.conclusion ?? "unavailable";
const runUrl = result?.html_url ?? "";
const summary = [
  `Release E2E: ${conclusion}`,
  runUrl ? `Actions run: ${runUrl}` : `Actions run: ${failure ?? "unknown"}`,
  `Private report: ${reportUrl}`,
  blocking ? "Mode: blocking" : "Mode: advisory (release not blocked)",
].join("\n");
console.log(summary);
if (failure) console.warn(`::warning::Release E2E advisory: ${failure}`);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `e2e_conclusion=${conclusion}\ne2e_run_url=${runUrl}\nreport_url=${reportUrl}\n`
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "### Release E2E",
    "",
    `- Conclusion: **${conclusion}**`,
    runUrl ? `- [Actions run](${runUrl})` : `- Actions run: not found`,
    `- [Private report](${reportUrl})`,
    blocking
      ? "- Mode: blocking"
      : "- Mode: advisory, the release is not blocked by this result",
    "",
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}
