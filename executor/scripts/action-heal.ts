import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { checkRunHeal, HEAL_FILE, loadRunMisses, planHeal } from "../src/tools/action-heal";
import { readActionHealth, resolveQaRoot } from "../src/tools/action-health";
import type { ActionTable } from "../src/tools/action-table";

const USAGE = `Usage: action:heal <check|plan> --run-root RUN_ROOT [--qa-root QA_ROOT]
  plan   Per miss in RUN_ROOT/run-state/action-reuse.jsonl (identical intents grouped): the handling it
         needs (repair / add a minimal Action now / new candidate or gap / extend an Action / not repairable),
         the outcomes that close it and commands to start from.
  check  Exits non-zero unless every miss has a valid outcome in RUN_ROOT/${HEAL_FILE}:
         [{ intentId|intent, reason, outcome: repaired|new_candidate|extended|gap|deferred|not_repairable,
            actionName?, evidenceRef?, gapId?, deferReason? }]`;

const root = path.resolve(import.meta.dirname, "..");

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"), allowPositionals: true,
    options: { "run-root": { type: "string" }, "qa-root": { type: "string" } },
  });
  const command = positionals[0];
  if (!["check", "plan"].includes(command ?? "") || !values["run-root"]) throw new Error(USAGE);
  const runRoot = path.resolve(values["run-root"]);
  if (command === "check") {
    const result = await checkRunHeal(runRoot);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      console.error(`${result.unresolved.length} of ${result.total} Action misses have no valid handling outcome in ${HEAL_FILE}:\n` +
        result.unresolved.map((item) => `  ${item.caseId}/${item.intentId} [${item.reason}] ${item.intent}: ${item.problem} ` +
          `(allowed: ${item.allowed.join(" | ")})`).join("\n"));
      process.exitCode = 1;
    }
    return;
  }
  const catalog = JSON.parse(await readFile(path.join(root, "src/tools/action-catalog.json"), "utf8")) as ActionTable;
  const plan = planHeal(await loadRunMisses(runRoot), { runRoot, catalog });
  const qaRoot = resolveQaRoot(runRoot, values["qa-root"]);
  const health = qaRoot ? await readActionHealth(qaRoot).catch(() => null) : null;
  console.log(JSON.stringify({
    runRoot, healFile: path.join(runRoot, HEAL_FILE),
    items: plan.map((item) => ({ ...item,
      ...(item.action && health?.actions[item.action] ? { health: health.actions[item.action].status } : {}) })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
