import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { addFollowup, inspectRun, type Followup } from "../loop/state";
import { locatorSearchTexts, type ActionFailureCategory } from "./action-failure";
import {
  actionCodeHash, healthNotice, readActionHealth, resolveQaRoot, updateActionHealth, type ActionHealthRecord, type HealthNotice,
} from "./action-health";
import { parseReuseLog, type ActionEntry } from "./action-index";
import { isSentinelReason } from "./silent-drift";

/**
 * Closeout drift repair. `list` gathers this run's drift-suspected invocations
 * and every Action whose health says suspected_drift; `verify` reruns a
 * repaired Action on E2B and concludes: repaired (health is already set back
 * to healthy by e2b:action) or still failing (a script_drift gap is opened in
 * the loop state so the next run picks it up).
 */
export type RunDriftFailure = {
  action: string;
  caseId: string;
  intentId: string | null;
  invocationId: string;
  category: ActionFailureCategory | null;
  locator: string | null;
  timeoutMs: number | null;
  finishedAt: string | null;
  /** RUN_ROOT-relative. */
  factRef: string;
  snapshotRef: string | null;
};

const posix = (value: string) => value.split(path.sep).join("/");

async function listDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function collectRunDriftFailures(runRoot: string): Promise<RunDriftFailure[]> {
  const failures: RunDriftFailure[] = [];
  const evidence = path.join(runRoot, "evidence");
  for (const caseId of (await listDirectory(evidence)).sort()) {
    const actions = path.join(evidence, caseId, "playwright", "actions");
    for (const name of (await listDirectory(actions)).sort()) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      let fact: Record<string, unknown>;
      try {
        fact = JSON.parse(await readFile(path.join(actions, name), "utf8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (fact.kind !== "action-invocation" || fact.driftSuspected !== true || typeof fact.action !== "string") continue;
      const failure = (fact.failure ?? {}) as Record<string, unknown>;
      const caseDir = path.join(evidence, caseId);
      failures.push({
        action: fact.action,
        caseId: typeof fact.caseId === "string" ? fact.caseId : caseId,
        intentId: typeof fact.intentId === "string" ? fact.intentId : null,
        invocationId: String(fact.invocationId ?? name.replace(/\.json$/, "")),
        category: typeof failure.category === "string" ? failure.category as ActionFailureCategory : null,
        locator: typeof failure.locator === "string" ? failure.locator : null,
        timeoutMs: typeof failure.timeoutMs === "number" ? failure.timeoutMs : null,
        finishedAt: typeof fact.finishedAt === "string" ? fact.finishedAt : null,
        factRef: posix(path.relative(runRoot, path.join(actions, name))),
        snapshotRef: typeof fact.failureSnapshot === "string"
          ? posix(path.relative(runRoot, path.join(caseDir, fact.failureSnapshot)))
          : null,
      });
    }
  }
  return failures;
}

/**
 * A drift the operator reported instead of the classifier: a Computer Use miss
 * logged with `--miss-reason drift --miss-action X`, or a read whose
 * cross-check was settled as drift (`action:reuse confirm --result drift`).
 */
export type ReportedDrift = {
  action: string;
  caseId: string;
  intentId: string;
  source: string;
  via: "miss" | "crosscheck";
};

/** Reported drift in this run's reuse log (RUN_ROOT/run-state/action-reuse.jsonl); [] when it is missing or unreadable. */
export async function collectRunReportedDrift(runRoot: string): Promise<ReportedDrift[]> {
  let contents: string;
  try {
    contents = await readFile(path.join(runRoot, "run-state", "action-reuse.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let events;
  try { events = parseReuseLog(contents).events; } catch { return []; }
  return events.filter((event) => event.outcome === "miss" && event.reason === "drift" && event.action)
    .map((event) => ({
      action: event.action!, caseId: event.caseId, intentId: event.intentId, source: event.source,
      via: event.crossCheck?.result === "drift" ? "crosscheck" as const : "miss" as const,
    }));
}

/**
 * Marks an Action suspected_drift for a drift reported by hand, so the next run
 * sees the health notice and `action:drift list` picks it up even when this
 * run's directory is not passed.
 */
export async function recordReportedDrift(qaRoot: string, input: {
  action: string; runId: string; codeHash: string; environment?: string; productSha?: string | null;
  evidenceRef?: string | null; at?: string;
}): Promise<ActionHealthRecord | null> {
  return updateActionHealth(qaRoot, {
    action: input.action, kind: "drift",
    stamp: { at: input.at ?? new Date().toISOString(), runId: input.runId, environment: input.environment ?? "unknown",
      productSha: input.productSha ?? null, codeHash: input.codeHash },
    failure: { category: "reported_drift", locator: null, evidenceRef: input.evidenceRef ?? null },
  });
}

export type DriftListItem = {
  action: string;
  /** file:line of the Action in hy_ui_autotest, or null when it is no longer exported. */
  source: string | null;
  health: HealthNotice & { record: ActionHealthRecord | null };
  runFailures: RunDriftFailure[];
  /** Drift reported by hand in this run (Computer Use drift miss or refuted cross-check). */
  reportedMisses: ReportedDrift[];
  searchTexts: string[];
  /** A starting command to find where the product changed the texts the locator relies on. */
  productSearch: string | null;
};

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export async function listDrift(input: {
  qaRoot: string | null;
  runRoot?: string;
  entries: readonly ActionEntry[];
  codeHashes: Readonly<Record<string, string>>;
  productRepo: string;
  productRef?: string;
}): Promise<DriftListItem[]> {
  const health = input.qaRoot ? await readActionHealth(input.qaRoot) : { schemaVersion: 1 as const, actions: {} };
  const runFailures = input.runRoot ? await collectRunDriftFailures(input.runRoot) : [];
  const reported = input.runRoot ? await collectRunReportedDrift(input.runRoot) : [];
  const names = new Set<string>([...runFailures.map((failure) => failure.action), ...reported.map((item) => item.action)]);
  for (const [name, record] of Object.entries(health.actions)) {
    if (record.status === "suspected_drift") names.add(name);
  }
  const ref = input.productRef ?? "origin/staging";
  const byName = new Map(input.entries.map((entry) => [entry.name, entry]));
  return [...names].sort().map((action) => {
    const entry = byName.get(action);
    const record = health.actions[action] ?? null;
    const failures = runFailures.filter((failure) => failure.action === action);
    const locator = failures.find((failure) => failure.locator)?.locator ?? record?.lastFailure?.locator ?? null;
    const searchTexts = locatorSearchTexts(locator);
    const notice = healthNotice(action, record ?? undefined, entry ? input.codeHashes[entry.file] ?? null : null);
    return {
      action,
      source: entry ? `${entry.file}:${entry.line}` : null,
      health: { ...notice, record },
      runFailures: failures,
      reportedMisses: reported.filter((item) => item.action === action),
      searchTexts,
      productSearch: searchTexts.length
        ? `git -C ${input.productRepo} fetch origin staging && ` + searchTexts.map((text) =>
          `git -C ${input.productRepo} log ${ref} --oneline -S${shellQuote(text)} -- apps/dashboard/src`).join(" ; ")
        : null,
    };
  });
}

export type DriftVerifyConclusion = {
  action: string;
  outcome: "repaired" | "gap_registered" | "gap_pending";
  gap: Followup | null;
  /** When the source run is not registered in the loop state: the command to run once it is. */
  addGapCommand: string | null;
  reason: string | null;
};

function gapKey(text: string): string {
  return text.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "").slice(0, 120);
}

/**
 * Concludes a drift verify rerun. Completed: recorded as repaired. Anything
 * else: a script_drift gap pointing at the frozen failure evidence, opened in
 * QA_ROOT/.qa-loop/followups under the run's journey. Every conclusion is
 * appended to RUN_ROOT/run-state/drift-repair.jsonl.
 */
export async function concludeDriftVerify(input: {
  qaRoot: string;
  runRoot: string;
  action: string;
  caseId: string;
  rerun: { status: string; invocationId: string | null; factPath: string | null; failureSnapshot?: string | null; error?: string | null };
  now?: Date;
}): Promise<DriftVerifyConclusion> {
  const now = input.now ?? new Date();
  const runId = path.basename(path.resolve(input.runRoot));
  let conclusion: DriftVerifyConclusion;
  if (input.rerun.status === "completed") {
    conclusion = { action: input.action, outcome: "repaired", gap: null, addGapCommand: null, reason: null };
  } else {
    const evidence = input.rerun.failureSnapshot ?? input.rerun.factPath;
    const sourceRef = evidence ? posix(path.relative(input.qaRoot, path.resolve(evidence))) : null;
    const gapId = gapKey(`script-drift-${input.action}-${runId}`);
    const mechanismKey = gapKey(`script-drift.${input.action}`);
    let journeyKey: string | null = null;
    try {
      journeyKey = (await inspectRun(input.qaRoot, runId)).journeyKey;
    } catch {
      journeyKey = null;
    }
    const command = `pnpm loop:state -- add-gap --qa-root ${input.qaRoot} --gap-id ${gapId} ` +
      `--journey-key ${journeyKey ?? "<journeyKey>"} --mechanism-key ${mechanismKey} --kind script_drift ` +
      `--source-run ${runId} --case-id ${gapKey(input.caseId)} --source-ref ${sourceRef ?? "<frozen evidence>"} ` +
      "--next-trigger action-drift-verify";
    if (!journeyKey || !sourceRef) {
      conclusion = { action: input.action, outcome: "gap_pending", gap: null, addGapCommand: command,
        reason: !journeyKey ? `Run ${runId} is not registered in loop:state (init it, then run the command)` : "No frozen evidence to point at" };
    } else {
      try {
        const gap = await addFollowup(input.qaRoot, {
          gapId, journeyKey, mechanismKey, kind: "script_drift",
          source: { runId, caseId: gapKey(input.caseId), ref: sourceRef },
          prerequisites: [], nextTrigger: "action-drift-verify",
        }, now);
        conclusion = { action: input.action, outcome: "gap_registered", gap, addGapCommand: null, reason: null };
      } catch (error) {
        conclusion = { action: input.action, outcome: "gap_pending", gap: null, addGapCommand: command,
          reason: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  const log = path.join(input.runRoot, "run-state", "drift-repair.jsonl");
  await mkdir(path.dirname(log), { recursive: true });
  // RUN_ROOT-relative references for the summary-freeze drift gate (src/loop/drift-gate.ts).
  const runRelative = (file: string | null | undefined): string | null => {
    if (!file) return null;
    const relativePath = posix(path.relative(path.resolve(input.runRoot), path.resolve(file)));
    return relativePath.startsWith("..") ? null : relativePath;
  };
  const verdict = input.rerun.status === "completed"
    ? { repair: "done" as const, verifyRef: runRelative(input.rerun.factPath) }
    : {
      repair: "failed" as const,
      blocker: `verify rerun of ${input.action} on E2B ended ${input.rerun.status}` +
        (input.rerun.error ? `: ${input.rerun.error}` : " (see evidenceRef for the failure facts)"),
      evidenceRef: runRelative(input.rerun.failureSnapshot ?? input.rerun.factPath),
    };
  await appendFile(log, `${JSON.stringify({
    at: now.toISOString(), action: input.action, caseId: input.caseId, outcome: conclusion.outcome,
    invocationId: input.rerun.invocationId, rerunStatus: input.rerun.status,
    gapId: conclusion.gap?.gapId ?? null, reason: conclusion.reason, ...verdict,
  })}\n`);
  return conclusion;
}

/**
 * Best effort: marks health for a drift reuse event (miss with reason drift and
 * an Action) right after it is logged. QA_ROOT comes from the shared run-root
 * rule; the evidence is the QA_ROOT-relative reuse log. Never throws.
 */
export async function reportDriftForEvent(input: {
  event: { outcome: string; reason?: string; action?: string; runId: string; crossCheck?: { result: string; reasons?: string[] } };
  reuseLog: string;
  entries: readonly ActionEntry[];
  skillRoot: string;
  qaRoot?: string | null;
}): Promise<{ health: ActionHealthRecord | null; healthError: string | null }> {
  const { event } = input;
  // A cross-check settled as a hit verified the Action at this code: e2b:action held the health
  // update back while the read was pending, so apply the success transition now.
  const confirmedHit = event.outcome === "hit" && event.crossCheck?.result === "hit" && Boolean(event.action);
  if (!confirmedHit && (event.outcome !== "miss" || event.reason !== "drift" || !event.action)) {
    return { health: null, healthError: null };
  }
  // A drift sentinel already marked the Action suspected_drift when e2b:action logged the
  // reading; refuting that reading must not count the same drift twice.
  if (!confirmedHit && event.crossCheck?.result === "drift" && (event.crossCheck.reasons ?? []).some(isSentinelReason)) {
    return { health: null, healthError: null };
  }
  try {
    const runRoot = path.dirname(path.dirname(path.resolve(input.reuseLog)));
    const qaRoot = input.qaRoot ?? resolveQaRoot(runRoot);
    if (!qaRoot) return { health: null, healthError: "QA_ROOT not found for this run; health not updated" };
    const entry = input.entries.find((item) => item.name === event.action);
    if (!entry) return { health: null, healthError: `${event.action} is not an indexed Action` };
    if (confirmedHit) {
      const health = await updateActionHealth(qaRoot, {
        action: event.action!, kind: "completed",
        stamp: { at: new Date().toISOString(), runId: event.runId, environment: "unknown", productSha: null,
          codeHash: actionCodeHash(input.skillRoot, entry.file) },
      });
      return { health, healthError: null };
    }
    const health = await recordReportedDrift(qaRoot, {
      action: event.action!, runId: event.runId, codeHash: actionCodeHash(input.skillRoot, entry.file),
      evidenceRef: posix(path.relative(qaRoot, path.resolve(input.reuseLog))),
    });
    return { health, healthError: null };
  } catch (error) {
    return { health: null, healthError: error instanceof Error ? error.message : String(error) };
  }
}
