import path from "node:path";
import { parseArgs } from "node:util";

import { applyPrune, planPrune } from "../src/tools/action-prune";
import { loadQaEnv } from "../src/tools/qa-env";

const USAGE = `Usage: action:prune [--qa-root QA_ROOT] [--now ISO] [--apply]
  Stamps firstSeen for catalog Actions without a health record, then lists deletion candidates:
  unhealthy (consecutiveFailures >= 3, or a script_drift followup open > 14 days) and stale
  (firstSeen > 30 days ago and no trusted use in 30 days). Pinned rows, undoneBy targets and Actions
  referenced in src/ tests/ scripts/ are reported *_protected. Without --apply it prints the plan only.
  --apply removes each declaration (JSDoc included), its catalog row, dedicated tests and health record,
  runs tsc + unit tests (restoring everything on failure) and archives each deletion to
  QA_ROOT/.qa-loop/action-prune.jsonl. QA_ROOT defaults to QA_ROOT from env or qa-env/.env.local.`;

const root = path.resolve(import.meta.dirname, "..");

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: { "qa-root": { type: "string" }, now: { type: "string" }, apply: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) { console.log(USAGE); return; }
  loadQaEnv();
  const qaRoot = values["qa-root"]?.trim() ? path.resolve(values["qa-root"])
    : process.env.QA_ROOT?.trim() ? path.resolve(process.env.QA_ROOT.trim()) : null;
  if (!qaRoot) throw new Error(`Cannot find QA_ROOT; pass --qa-root\n${USAGE}`);
  const now = values.now ? new Date(values.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error(`--now must be an ISO time\n${USAGE}`);
  const plan = await planPrune({ skillRoot: root, qaRoot, now });
  if (!values.apply) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const result = await applyPrune({ skillRoot: root, qaRoot, plan, now });
  console.log(JSON.stringify({
    stamped: plan.stamped,
    deleted: result.deleted.map(({ removedSource: _source, removedTests, ...line }) => ({ ...line, removedTests: removedTests.map((test) => test.file) })),
    protected: result.protected,
    checks: result.checks,
    archive: result.deleted.length ? path.join(qaRoot, ".qa-loop", "action-prune.jsonl") : null,
  }, null, 2));
  if (result.checks && !result.checks.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
