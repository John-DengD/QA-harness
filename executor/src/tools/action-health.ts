import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ActionCandidate } from "./action-select";
import type { ActionFailureCategory } from "./action-failure";
import { resolveQaRootForRun } from "../loop/run-root";

/**
 * Cross-run health of each library Action, kept in QA_ROOT/.qa-loop/action-health.json.
 *
 * It lives beside the loop state, not in the skill, because it is a runtime
 * observation (this Action, at this code version, on this deployment) that
 * changes on every run: in the skill it would dirty read-only installs and
 * churn commits. It still follows the code: every stamp carries the hash of
 * the Action's source file, so a repaired Action whose last drift was seen on
 * older code is reported as "changed since, re-verify" rather than as broken.
 *
 * Health never gates a call. A suspected Action stays selectable and runnable;
 * the notice only tells the operator to repair it first or use Computer Use.
 */
export type ActionHealthStatus = "healthy" | "suspected_drift";

export type ActionHealthStamp = {
  at: string;
  runId: string;
  /** App host the Action ran against, e.g. app-staging.hellyeahai.com. */
  environment: string;
  /** Product deployment SHA when the run knew it. */
  productSha: string | null;
  /** First 12 hex of sha256 over the Action's source file. */
  codeHash: string;
};

export type ActionHealthFailure = ActionHealthStamp & {
  category: ActionFailureCategory;
  locator: string | null;
  /** QA_ROOT-relative failure evidence (snapshot or fact). */
  evidenceRef: string | null;
};

export type ActionHealthRecord = {
  status: ActionHealthStatus;
  consecutiveFailures: number;
  lastVerified: ActionHealthStamp | null;
  lastFailure: ActionHealthFailure | null;
  /**
   * When the Action was first recorded (or first stamped by action:prune). Absent in
   * older files: then the earliest stamp the record carries stands in for it.
   */
  firstSeen?: string;
  /** Last trusted successful invocation (a counted hit, a cross-check confirmed hit or a verify pass). */
  lastUsed?: string | null;
  // Older files may still carry `lastHealthyShape` (the retired silent-drift baseline):
  // it is ignored on read and dropped on the next update of that Action.
};

export type ActionHealthFile = {
  schemaVersion: 1;
  actions: Record<string, ActionHealthRecord>;
};

export type ActionHealthOutcome =
  | { action: string; kind: "completed"; stamp: ActionHealthStamp }
  | { action: string; kind: "drift"; stamp: ActionHealthStamp;
      failure: { category: ActionFailureCategory; locator: string | null; evidenceRef: string | null } }
  | { action: string; kind: "other_failure"; stamp: ActionHealthStamp };

export type HealthNotice = {
  status: ActionHealthStatus | "unknown";
  notice: string | null;
  codeChangedSinceFailure: boolean;
};

export const ACTION_HEALTH_FILE = path.join(".qa-loop", "action-health.json");

export function emptyActionHealth(): ActionHealthFile {
  return { schemaVersion: 1, actions: {} };
}

/** Pure transition: success verifies and clears; drift counts and marks; other failures change nothing. */
export function applyHealthOutcome(file: ActionHealthFile, outcome: ActionHealthOutcome): ActionHealthFile {
  if (outcome.kind === "other_failure") return file;
  const previous = file.actions[outcome.action];
  const firstSeen = recordFirstSeen(previous) ?? outcome.stamp.at;
  const lastUsed = outcome.kind === "completed" ? outcome.stamp.at : previous?.lastUsed ?? null;
  const record: ActionHealthRecord = outcome.kind === "completed"
    ? { status: "healthy", consecutiveFailures: 0, lastVerified: { ...outcome.stamp }, lastFailure: previous?.lastFailure ?? null,
        firstSeen, lastUsed }
    : {
        status: "suspected_drift",
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
        lastVerified: previous?.lastVerified ?? null,
        lastFailure: { ...outcome.stamp, ...outcome.failure },
        firstSeen, lastUsed,
      };
  return { schemaVersion: 1, actions: { ...file.actions, [outcome.action]: record } };
}

/** firstSeen, or for an older record the earliest stamp it carries; null when it has none. */
export function recordFirstSeen(record: ActionHealthRecord | undefined): string | null {
  if (!record) return null;
  if (record.firstSeen) return record.firstSeen;
  const stamps = [record.lastVerified?.at, record.lastFailure?.at].filter((at): at is string => typeof at === "string");
  return stamps.length ? stamps.sort()[0] : null;
}

/** lastUsed, or for an older record its lastVerified time; null when never used. */
export function recordLastUsed(record: ActionHealthRecord | undefined): string | null {
  if (!record) return null;
  if (record.lastUsed !== undefined) return record.lastUsed;
  return record.lastVerified?.at ?? null;
}

/** Pure: adds a fresh healthy record (firstSeen = now) for each named Action that has none. */
export function applyFirstSeen(file: ActionHealthFile, actions: readonly string[], now: Date): { file: ActionHealthFile; stamped: string[] } {
  const stamped = [...new Set(actions)].filter((name) => !Object.hasOwn(file.actions, name));
  if (!stamped.length) return { file, stamped };
  const added = Object.fromEntries(stamped.map((name) => [name, {
    status: "healthy", consecutiveFailures: 0, lastVerified: null, lastFailure: null, firstSeen: now.toISOString(),
  } satisfies ActionHealthRecord]));
  return { file: { schemaVersion: 1, actions: { ...file.actions, ...added } }, stamped };
}

export function healthNotice(action: string, record: ActionHealthRecord | undefined, currentCodeHash: string | null): HealthNotice {
  if (!record) return { status: "unknown", notice: null, codeChangedSinceFailure: false };
  if (record.status === "healthy") return { status: "healthy", notice: null, codeChangedSinceFailure: false };
  const failure = record.lastFailure;
  const where = failure ? `${failure.environment} ${failure.at.slice(0, 10)}，run ${failure.runId}` : "上次运行";
  const codeChanged = Boolean(failure && currentCodeHash && failure.codeHash !== currentCodeHash);
  if (codeChanged) {
    return {
      status: "suspected_drift",
      codeChangedSinceFailure: true,
      notice: `${action} 上次疑似漂移（${where}）后代码已改动，尚未在真实页面重验：先跑 pnpm action:drift verify ${action}，` +
        `或直接用 Computer Use 并记 --miss-reason drift --miss-action ${action}`,
    };
  }
  return {
    status: "suspected_drift",
    codeChangedSinceFailure: false,
    notice: `${action} 可能已失效，先修或直接用 Computer Use 完成该意图并记 --miss-reason drift --miss-action ${action}` +
      `（${where}，连续 ${record.consecutiveFailures} 次定位/超时失败；不禁止调用）`,
  };
}

export function actionCodeHash(root: string, file: string): string {
  return createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex").slice(0, 12);
}

/** Code hash of every source file the given Actions live in. */
export function actionCodeHashes(root: string, files: readonly string[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of new Set(files)) {
    try { hashes[file] = actionCodeHash(root, file); } catch { /* unreadable file: no hash */ }
  }
  return hashes;
}

export type ActionHealthView = { status: ActionHealthFile; codeHashes: Readonly<Record<string, string>> };

export function noticeFor(view: ActionHealthView | undefined, action: { name: string; file: string }): HealthNotice {
  if (!view) return { status: "unknown", notice: null, codeChangedSinceFailure: false };
  return healthNotice(action.name, view.status.actions[action.name], view.codeHashes[action.file] ?? null);
}

export function annotateCandidatesWithHealth(
  candidates: readonly ActionCandidate[],
  health: ActionHealthFile,
  codeHashes: Readonly<Record<string, string>>,
): Array<ActionCandidate & { health: HealthNotice }> {
  return candidates.map((candidate) => ({
    ...candidate,
    health: noticeFor({ status: health, codeHashes }, candidate.action),
  }));
}

/**
 * QA_ROOT for a run. Delegates to the shared rule in loop/run-root.ts:
 * explicit value, then env QA_ROOT around the run, then the nearest ancestor
 * with .qa-loop, then three levels above RUN_ROOT. Null when none applies.
 */
export function resolveQaRoot(runRoot: string, explicit?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveQaRootForRun(runRoot, explicit, env);
}

function parseHealth(raw: unknown): ActionHealthFile {
  if (!raw || typeof raw !== "object" || (raw as ActionHealthFile).schemaVersion !== 1 ||
      typeof (raw as ActionHealthFile).actions !== "object" || (raw as ActionHealthFile).actions === null) {
    throw new Error("Invalid action-health.json: expected { schemaVersion: 1, actions: {...} }");
  }
  return raw as ActionHealthFile;
}

export async function readActionHealth(qaRoot: string): Promise<ActionHealthFile> {
  try {
    return parseHealth(JSON.parse(await readFile(path.join(qaRoot, ACTION_HEALTH_FILE), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyActionHealth();
    throw error;
  }
}

async function withLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const handle = await open(lock, "wx");
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A lock left behind by a killed writer goes stale after 30 s.
      const age = await stat(lock).then((info) => Date.now() - info.mtimeMs).catch(() => 0);
      if (age > 30_000) await rm(lock, { force: true });
      else if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lock}`);
      else await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 40));
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}

/** Reads, transforms and atomically rewrites the health file under its lock. */
export async function mutateActionHealth<T>(
  qaRoot: string, change: (current: ActionHealthFile) => { file: ActionHealthFile; result: T },
): Promise<T> {
  const file = path.join(qaRoot, ACTION_HEALTH_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  return withLock(file, async () => {
    const current = await readActionHealth(qaRoot);
    const { file: next, result } = change(current);
    if (next !== current) {
      const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, file);
    }
    return result;
  });
}

/** Applies one outcome under a lock and an atomic rename; returns the Action's new record. */
export async function updateActionHealth(qaRoot: string, outcome: ActionHealthOutcome): Promise<ActionHealthRecord | null> {
  return mutateActionHealth(qaRoot, (current) => {
    const next = applyHealthOutcome(current, outcome);
    return { file: next, result: next.actions[outcome.action] ?? null };
  });
}

/**
 * Starts the clock for catalog Actions that have no health record yet: adds
 * { healthy, consecutiveFailures 0, firstSeen: now } and leaves existing records
 * untouched. Returns the names it stamped.
 */
export async function stampFirstSeen(qaRoot: string, catalogActionNames: readonly string[], now = new Date()): Promise<string[]> {
  return mutateActionHealth(qaRoot, (current) => {
    const { file, stamped } = applyFirstSeen(current, catalogActionNames, now);
    return { file, result: stamped };
  });
}

/** Drops the named Actions' records (action:prune after a deletion). Returns the removed records. */
export async function removeActionHealthRecords(qaRoot: string, actions: readonly string[]): Promise<Record<string, ActionHealthRecord>> {
  return mutateActionHealth(qaRoot, (current) => {
    const removed: Record<string, ActionHealthRecord> = {};
    const kept = { ...current.actions };
    for (const name of actions) {
      if (Object.hasOwn(kept, name)) { removed[name] = kept[name]; delete kept[name]; }
    }
    return Object.keys(removed).length
      ? { file: { schemaVersion: 1, actions: kept }, result: removed }
      : { file: current, result: removed };
  });
}
