import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseReuseLog } from "../tools/action-index";
import { collectRunDriftFailures, collectRunReportedDrift } from "../tools/action-drift";

/**
 * Summary-freeze gate for closeout drift repair (references/playwright-actions.md §6.3).
 *
 * A run that saw a drifted Action must say, per Action, what became of it in
 * `RUN_ROOT/run-state/drift-repair.jsonl`:
 * - `repair: "done"` with `verifyRef`: a RUN_ROOT-relative file that exists (the `action:drift verify`
 *   invocation fact or its saved output), so the repair is traceable to a real-page rerun;
 * - `repair: "not_attempted" | "failed"` with `gapId` (the registered script_drift gap), a `blocker` that is a
 *   concrete reason (not a generic excuse) and `evidenceRef`, an existing RUN_ROOT-relative file showing it.
 *
 * Why both a blacklist and an evidence file: the blacklist alone is beaten by rewording ("someone said not to"),
 * and a file alone is beaten by pointing at any file. Together the writer has to name a concrete obstacle and
 * leave something a reviewer can open. The last row per Action wins, so a correction is appended, never edited.
 *
 * Drift signs: a `drift` miss (or a cross-check settled as drift) in the reuse log, or an invocation fact with
 * `driftSuspected: true`. A run with neither sign and no record file is not checked.
 */
const REPAIRS = ["done", "not_attempted", "failed"] as const;
const MIN_BLOCKER_LENGTH = 12;

/** Excuses that say who or what stopped the repair, not what blocks it. Lowercased input, Chinese and English. */
const GENERIC_EXCUSES: readonly RegExp[] = [
  /不(要)?现场|现场(修改|改)/,
  /(用户|派单|有人|要求|指示|禁止|不允许|user|instruction|told|asked|said).*(不|别|勿|禁止|不许|不准|no\b|not\b|don'?t|never).*(修|改|edit|fix|repair|modify|touch)/,
  /(时间|时限|精力|工时).{0,4}(不够|不足|有限|紧|来不及)|来不及|没时间|没空|太忙/,
  /not enough time|no time|out of time|time (is )?(short|limited)|too busy|running late/,
  /按\s*skill\s*规则登记|按规则登记/,
  /下一?轮再|后续再|以后再|稍后再|之后再|later|next (run|time|round)/,
  /^\s*(同上|同前|见上|n\/?a|none|todo|tbd|unknown|无|没有)\s*[.。]?\s*$/,
];

export function isGenericExcuse(blocker: string): boolean {
  const text = blocker.trim().toLowerCase();
  return text.length < MIN_BLOCKER_LENGTH || GENERIC_EXCUSES.some((pattern) => pattern.test(text));
}

type Row = Record<string, unknown>;

/** Rows written by an older `action:drift verify` carry only `outcome`; a repaired one maps to done via its invocation fact. */
function normalizeRow(row: Row): Row {
  if (row.repair !== undefined || row.outcome !== "repaired") return row;
  const verifyRef = typeof row.caseId === "string" && typeof row.invocationId === "string"
    ? `evidence/${row.caseId}/playwright/actions/${row.invocationId}.json` : undefined;
  return { ...row, repair: "done", verifyRef };
}

function isRunFile(runRoot: string, ref: unknown): boolean {
  if (typeof ref !== "string" || !ref.trim() || path.isAbsolute(ref)) return false;
  const resolved = path.resolve(runRoot, ref);
  if (resolved !== runRoot && !resolved.startsWith(`${runRoot}${path.sep}`)) return false;
  return existsSync(resolved) && statSync(resolved).isFile();
}

/** Problems with the latest row of each Action (RUN_ROOT absolute). Empty when every row is acceptable. */
export function validateDriftRepairRecords(input: readonly Row[], runRoot: string): string[] {
  const rows = input.map((row) => normalizeRow(row));
  const latest = new Map<string, Row>();
  for (const row of rows) if (typeof row.action === "string" && row.action) latest.set(row.action, row);
  const problems: string[] = [];
  for (const row of rows) {
    if (typeof row.action !== "string" || !row.action) problems.push("a record has no action");
    else if (!REPAIRS.includes(row.repair as typeof REPAIRS[number])) {
      problems.push(`${row.action}: repair must be one of ${REPAIRS.join(", ")}`);
    }
  }
  for (const [action, row] of latest) {
    if (row.repair === "done") {
      if (!isRunFile(runRoot, row.verifyRef)) {
        problems.push(`${action}: repair "done" needs verifyRef, an existing RUN_ROOT-relative file with the action:drift verify result`);
      }
    } else if (row.repair === "not_attempted" || row.repair === "failed") {
      if (typeof row.blocker !== "string" || isGenericExcuse(row.blocker)) {
        problems.push(`${action}: blocker must name the concrete obstacle (page data unavailable, irreversible step needed, ...); ` +
          "\"someone said not to fix it\", \"no time\", \"same as above\" are not reasons (playwright-actions.md §6.3)");
      }
      if (typeof row.gapId !== "string" || !row.gapId.trim()) {
        problems.push(`${action}: ${row.repair} needs gapId, the script_drift gap registered with pnpm loop:state`);
      }
      if (!isRunFile(runRoot, row.evidenceRef)) {
        problems.push(`${action}: ${row.repair} needs evidenceRef, an existing RUN_ROOT-relative file that shows the blocker`);
      }
    }
  }
  return problems;
}

async function readRows(file: string): Promise<Row[] | null> {
  let contents: string;
  try { contents = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return contents.split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) return [value as Row];
    } catch { /* reported below */ }
    throw new Error(`drift-repair.jsonl line ${index + 1} is not a JSON object`);
  });
}

async function driftActions(runRoot: string, actionLog?: string): Promise<string[]> {
  const actions = new Set<string>();
  for (const failure of await collectRunDriftFailures(runRoot)) actions.add(failure.action);
  for (const drift of await collectRunReportedDrift(runRoot)) actions.add(drift.action);
  const standard = path.join(runRoot, "run-state", "action-reuse.jsonl");
  if (actionLog && path.resolve(actionLog) !== standard) {
    try {
      for (const event of parseReuseLog(await readFile(actionLog, "utf8")).events) {
        if (event.outcome === "miss" && event.reason === "drift" && event.action) actions.add(event.action);
      }
    } catch { /* an unreadable log is the checker's own error, not this gate's */ }
  }
  return [...actions].sort();
}

export type DriftGateResult = { checked: boolean; actions: string[] };

/**
 * Throws unless every drift sign of this run is answered by an acceptable drift-repair.jsonl record.
 * `runRoot` and `actionLog` are absolute paths.
 */
export async function assertDriftRepairRecorded(runRoot: string, actionLog?: string): Promise<DriftGateResult> {
  const root = path.resolve(runRoot);
  const drifted = await driftActions(root, actionLog);
  const file = path.join(root, "run-state", "drift-repair.jsonl");
  const rows = await readRows(file);
  if (!drifted.length && rows === null) return { checked: false, actions: [] };
  const hint = "Repair the Action and run pnpm action:drift verify <Action>, or register the gap and record a concrete blocker; " +
    "one JSON row per Action in RUN_ROOT/run-state/drift-repair.jsonl: " +
    '{"action","repair":"done","verifyRef"} or {"action","repair":"not_attempted|failed","gapId","blocker","evidenceRef"} ' +
    "(references/playwright-actions.md §6.3)";
  if (!rows?.length) {
    throw new Error(`run-state/drift-repair.jsonl is missing or empty, but this run saw drift (${drifted.join(", ")}). ${hint}`);
  }
  const problems = validateDriftRepairRecords(rows, root);
  const recorded = new Set(rows.map((row) => row.action));
  for (const action of drifted) {
    if (!recorded.has(action)) problems.push(`${action}: drifted in this run but has no drift-repair.jsonl record`);
  }
  if (problems.length) throw new Error(`Drift repair is not settled:\n- ${problems.join("\n- ")}\n${hint}`);
  return { checked: true, actions: [...new Set([...drifted, ...recorded as Set<string>])].sort() };
}
