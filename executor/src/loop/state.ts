import { link, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  checkReviewerDecision, laneCloseoutRef, MERGED_SCOPE_MIXED, parseLaneCloseout, type CheckerLane, type CheckerPacket,
  type CheckerReview,
} from "./checker";
import { parseReuseLog } from "../tools/action-index";
import { parseRunRoot } from "./run-root";

export const runPhases = [
  "planned", "executing", "awaiting_review", "changes_requested", "reviewed", "published", "interrupted",
] as const;
export type RunPhase = typeof runPhases[number];
export type RunRefs = Partial<Record<
  "actionLog" | "caseHarvest" | "videoManifest" | "runState" | "report" |
  "checkerPacket" | "checkerReview" | "bundle" | "delivery", string
>> & { taskModel: string };

export type RunIdentity = {
  runId: string;
  runRoot: string;
  journeyKey: string;
  mode: "new" | "regression";
  scope: { feature: string; environment: string; role: string; orgAlias: string; deploymentSha: string };
  executorId: string;
  parentRunId?: string;
  /**
   * Parallel lanes of one ticket/PR (references/parallel-e2b.md). A lane run (`laneOf` = the merged run's id, `lane` =
   * one of its labels) executes Cases normally. A merged run (`lanes` = the labels it expects) executes none: it owns
   * the single omission plan, the merged report and the summary review.
   */
  laneOf?: string;
  lane?: string;
  lanes?: string[];
};

export type RunRecord = RunIdentity & {
  schemaVersion: 1;
  refs: RunRefs;
  phase: RunPhase;
  createdAt: string;
  updatedAt: string;
  recoveryRequired?: boolean;
  recoveryRef?: string;
};

export type GapKind = "action_miss" | "case_gap" | "knowledge_gap" | "fixture" | "script_drift";
export type FollowupInput = {
  gapId: string;
  journeyKey: string;
  mechanismKey: string;
  kind: GapKind;
  intentKey?: string;
  source: { runId: string; caseId: string; ref: string };
  prerequisites: string[];
  nextTrigger: string;
};
export type Followup = FollowupInput & {
  schemaVersion: 1;
  status: "open" | "claimed" | "validated" | "retired";
  createdAt: string;
  updatedAt: string;
  claim?: { runId: string; executorId: string; expiresAt: string };
  resolution?: { kind: "validated" | "retired"; runId: string; caseId: string; ref: string; reason?: string };
};

const phaseTransitions: Record<RunPhase, RunPhase[]> = {
  planned: ["executing", "interrupted"],
  executing: ["awaiting_review", "interrupted"],
  awaiting_review: ["changes_requested", "reviewed", "interrupted"],
  changes_requested: ["executing", "awaiting_review", "interrupted"],
  reviewed: ["published", "changes_requested"],
  published: [],
  interrupted: ["executing", "awaiting_review"],
};
const refNames = new Set(["taskModel", "actionLog", "caseHarvest", "videoManifest", "runState", "report", "checkerPacket", "checkerReview", "bundle", "delivery"]);
const gapKinds = new Set<GapKind>(["action_miss", "case_gap", "knowledge_gap", "fixture", "script_drift"]);

function key(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)) {
    throw new Error(`${label} must be a short, non-sensitive identifier (letters, numbers, dot, dash, underscore)`);
  }
  return value;
}

function assertTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${label}`);
  return value;
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertRunChild(runRoot: string, ref: string): void {
  if (!ref.startsWith(`${runRoot}/`)) throw new Error("Run evidence reference must belong to this runRoot");
}

async function rootPath(qaRoot: string): Promise<string> {
  const root = await realpath(qaRoot);
  if (!(await stat(root)).isDirectory()) throw new Error("QA_ROOT must be a directory");
  return root;
}

async function registry(root: string, subdirectory: "runs" | "followups"): Promise<string> {
  const base = path.join(root, ".qa-loop");
  for (const directory of [base, path.join(base, subdirectory)]) {
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink() || !within(root, await realpath(directory))) {
      throw new Error("Loop state directory must not be a symlink outside QA_ROOT");
    }
  }
  return path.join(base, subdirectory);
}

export async function assertQaRef(root: string, ref: string): Promise<string> {
  if (typeof ref !== "string" || !ref || ref.length > 512 || /[\x00-\x1f]/.test(ref) ||
      path.isAbsolute(ref) || ref.includes("\\") ||
      ref.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("State references must be clean QA_ROOT-relative paths");
  }
  const target = path.resolve(root, ref);
  if (!within(root, target)) throw new Error("State reference leaves QA_ROOT");
  let ancestor = target;
  while (true) {
    try {
      if (!within(root, await realpath(ancestor))) throw new Error("State reference resolves outside QA_ROOT");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
      if (!within(root, ancestor)) throw new Error("State reference leaves QA_ROOT");
    }
  }
  return target;
}

async function checkedRefs(root: string, refs: RunRefs): Promise<RunRefs> {
  if (!refs || typeof refs !== "object" || Array.isArray(refs) || !refs.taskModel) {
    throw new Error("taskModel reference is required");
  }
  for (const [name, ref] of Object.entries(refs)) {
    if (!refNames.has(name)) throw new Error(`Unknown run reference: ${name}; allowed: ${[...refNames].join(", ")}`);
    await assertQaRef(root, ref);
  }
  return refs;
}

async function existingRef(root: string, ref: string, kind: "file" | "directory" = "file"): Promise<void> {
  const target = await assertQaRef(root, ref);
  const metadata = await stat(target);
  if (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) {
    throw new Error(`Expected a ${kind} under QA_ROOT: ${ref}`);
  }
}

async function checkedReview(root: string, record: RunRecord, bundle?: string) {
  if (!record.refs.checkerPacket || !record.refs.checkerReview) {
    throw new Error("Independent checker packet and review references are required");
  }
  await existingRef(root, record.refs.checkerPacket);
  await existingRef(root, record.refs.checkerReview);
  const packet = JSON.parse(await readFile(await assertQaRef(root, record.refs.checkerPacket), "utf8")) as CheckerPacket;
  const review = JSON.parse(await readFile(await assertQaRef(root, record.refs.checkerReview), "utf8")) as CheckerReview;
  if (packet.runId === record.runId && packet.runRoot !== record.runRoot) {
    // Every packet path is QA_ROOT-relative: a different runRoot means it was frozen with another --qa-root.
    throw new Error(`Checker packet was frozen against another QA_ROOT: packet runRoot ${packet.runRoot}, ` +
      `registered runRoot ${record.runRoot}. Re-freeze it with the same QA_ROOT as loop:state ` +
      "(pnpm qa-env:root) and the registered runRoot");
  }
  const gate = await checkReviewerDecision(root, packet, review, bundle);
  if (packet.runId !== record.runId || packet.journeyKey !== record.journeyKey ||
      packet.runRoot !== record.runRoot ||
      packet.executorId !== record.executorId || packet.mode !== record.mode ||
      Object.entries(record.scope).some(([name, value]) => packet.scope[name as keyof RunIdentity["scope"]] !== value)) {
    throw new Error("Checker packet does not match the run identity");
  }
  for (const name of ["taskModel", "actionLog", "caseHarvest", "videoManifest", "runState", "report"] as const) {
    if (record.refs[name] !== undefined && record.refs[name] !== packet.refs[name]) {
      throw new Error(`Run ${name} reference differs from the frozen checker packet`);
    }
  }
  if (record.lanes) {
    if (!packet.lanes) throw new Error("A merged run needs a merged checker packet (qa:checker merge, then freeze)");
    assertPacketLanes(record, await listLaneRuns(root, record.runId), packet.lanes);
  } else if (packet.lanes) {
    throw new Error("Checker packet lists lanes, but this run is not a merged run");
  }
  return { packet, review, gate };
}

async function checkedDelivery(root: string, record: RunRecord, packet: CheckerPacket): Promise<void> {
  if (!record.refs.delivery || !record.refs.bundle || !record.refs.report) {
    throw new Error("Published run needs reviewed bundle, delivery receipt and local report references");
  }
  await existingRef(root, record.refs.delivery);
  await existingRef(root, record.refs.bundle, "directory");
  await existingRef(root, record.refs.report);
  const receipt = JSON.parse(await readFile(await assertQaRef(root, record.refs.delivery), "utf8")) as Record<string, unknown>;
  if (receipt.schemaVersion !== 1 || receipt.runId !== record.runId || receipt.packetDigest !== packet.digest ||
      receipt.visibility !== "workspace" || receipt.bundleDir !== record.refs.bundle ||
      receipt.artifactUrl !== String(receipt.artifactUrl)) {
    throw new Error("Delivery receipt does not match reviewed run and workspace visibility");
  }
  const url = new URL(String(receipt.artifactUrl));
  if (url.protocol !== "https:" || !["artifact.cafe", "hellyeah.artifact.cafe"].includes(url.hostname) ||
      !/^\/a\/[a-z0-9-]+$/.test(url.pathname) || url.search || url.hash ||
      receipt.workspace !== "hellyeah") {
    throw new Error("Delivery receipt must identify a Hellyeah workspace Artifact URL");
  }
  key(receipt.artifactId, "delivery.artifactId");
  if (!Number.isSafeInteger(receipt.version) || Number(receipt.version) < 1) {
    throw new Error("Delivery receipt needs a positive Artifact version");
  }
  const checks = receipt.onlineChecks as Record<string, unknown> | undefined;
  if (!checks || checks.shaMatched !== true || checks.casesVisible !== true ||
      checks.videosChecked !== true || checks.workspaceAccess !== true ||
      !Array.isArray(checks.videoCaseIds) ||
      checks.videoCaseIds.some((id) => !Number.isSafeInteger(id) || Number(id) < 1) ||
      new Set(checks.videoCaseIds).size !== checks.videoCaseIds.length) {
    throw new Error("Delivery receipt needs explicit successful online readback checks");
  }
  const watched = new Set(checks.videoCaseIds as number[]);
  const requiredVideos = packet.cases.filter((item) => item.executed && item.status !== "Pass").map((item) => item.id);
  const success = packet.cases.find((item) => item.executed && item.status === "Pass");
  if (requiredVideos.some((id) => !watched.has(id)) || (success && !packet.cases.some((item) =>
    item.executed && item.status === "Pass" && watched.has(item.id)))) {
    throw new Error("Online video readback must cover every failed Case and one successful Case");
  }
  const publishedAt = assertTimestamp(receipt.publishedAt, "delivery.publishedAt");
  const verifiedAt = assertTimestamp(receipt.verifiedAt, "delivery.verifiedAt");
  if (Date.parse(verifiedAt) < Date.parse(publishedAt)) throw new Error("Artifact readback preceded publication");
}

/** Names the allowed next phases and, when one step is missing, the command for it. */
export function phaseTransitionError(from: RunPhase, to: RunPhase, runId: string, executorId: string): string {
  const allowed = phaseTransitions[from];
  const bridge = allowed.find((next) => phaseTransitions[next].includes(to));
  return `Invalid phase transition: ${from} -> ${to}. Allowed next: ${allowed.join(", ") || "(none)"}.` +
    (bridge ? ` Next step: pnpm loop:state checkpoint --run-id ${runId} --executor-id ${executorId} --phase ${bridge}` +
      ` (record-start does not move the phase), then --phase ${to}.` : "");
}

/** Ref names `loop:state checkpoint --ref name=path` accepts. */
export const RUN_REF_NAMES = [...refNames];

function validateIdentity(identity: RunIdentity): RunIdentity {
  if (!identity || typeof identity !== "object") throw new Error("Run identity is required");
  key(identity.runId, "runId"); key(identity.journeyKey, "journeyKey"); key(identity.executorId, "executorId");
  if (typeof identity.runRoot !== "string" || path.posix.basename(identity.runRoot) !== identity.runId) {
    throw new Error("runRoot must end with this runId");
  }
  if (identity.parentRunId) key(identity.parentRunId, "parentRunId");
  if ((identity.laneOf === undefined) !== (identity.lane === undefined)) throw new Error("laneOf and lane must be given together");
  if (identity.laneOf !== undefined) {
    key(identity.laneOf, "laneOf"); key(identity.lane, "lane");
    if (identity.laneOf === identity.runId) throw new Error("A run cannot be a lane of itself");
    if (identity.lanes !== undefined) throw new Error("A lane run cannot also be a merged run (lanes)");
  }
  if (identity.lanes !== undefined) {
    if (!Array.isArray(identity.lanes) || identity.lanes.length < 2) throw new Error("A merged run needs at least two lane labels");
    identity.lanes.forEach((label) => key(label, "lane label"));
    if (new Set(identity.lanes).size !== identity.lanes.length) throw new Error("Duplicate lane label");
  }
  if (identity.mode !== "new" && identity.mode !== "regression") throw new Error("Invalid run mode");
  if (!identity.scope || typeof identity.scope !== "object") throw new Error("Run scope is required");
  for (const [name, value] of Object.entries(identity.scope)) {
    if (!["feature", "environment", "role", "orgAlias", "deploymentSha"].includes(name)) {
      throw new Error(`Unknown scope field: ${name}`);
    }
    key(value, `scope.${name}`);
  }
  for (const name of ["feature", "environment", "role", "orgAlias", "deploymentSha"]) {
    if (!Object.hasOwn(identity.scope, name)) throw new Error(`Missing scope.${name}`);
  }
  // Shared rule (run-root.ts): [<surface>/]<feature>/runs/<runId>, e.g. User-Dashboard-test/PR-1217/runs/<runId>.
  parseRunRoot(identity.runRoot, { feature: identity.scope.feature, runId: identity.runId });
  return identity;
}

function parseRun(value: unknown): RunRecord {
  if (!value || typeof value !== "object") throw new Error("Invalid run record");
  const run = value as RunRecord;
  if (run.schemaVersion !== 1 || !runPhases.includes(run.phase)) throw new Error("Unsupported run record");
  validateIdentity(run);
  assertTimestamp(run.createdAt, "createdAt"); assertTimestamp(run.updatedAt, "updatedAt");
  if (!run.refs || typeof run.refs !== "object" || !run.refs.taskModel) throw new Error("Missing taskModel reference");
  return run;
}

function parseFollowup(value: unknown): Followup {
  if (!value || typeof value !== "object") throw new Error("Invalid followup");
  const gap = value as Followup;
  if (gap.schemaVersion !== 1 || !["open", "claimed", "validated", "retired"].includes(gap.status)) {
    throw new Error("Unsupported followup record");
  }
  key(gap.gapId, "gapId"); key(gap.journeyKey, "journeyKey"); key(gap.mechanismKey, "mechanismKey");
  if (!gapKinds.has(gap.kind)) throw new Error("Invalid followup kind");
  if (gap.kind === "action_miss") key(gap.intentKey, "intentKey");
  key(gap.source.runId, "source.runId"); key(gap.source.caseId, "source.caseId");
  if (!Array.isArray(gap.prerequisites)) throw new Error("Invalid prerequisites");
  gap.prerequisites.forEach((item) => key(item, "prerequisite"));
  key(gap.nextTrigger, "nextTrigger");
  assertTimestamp(gap.createdAt, "createdAt"); assertTimestamp(gap.updatedAt, "updatedAt");
  return gap;
}

async function atomicCreate(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await link(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function atomicReplace(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withFileLock<T>(file: string, operation: (assertOwner: () => Promise<void>) => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await mkdir(lock);
      acquired = true;
      await writeFile(path.join(lock, "owner"), token, { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let lockMtime: number;
      try {
        lockMtime = (await stat(lock)).mtimeMs;
      } catch (race) {
        if ((race as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw race;
      }
      if (Date.now() - lockMtime > 120_000) {
        const stale = `${lock}.${randomUUID()}.stale`;
        try {
          await rename(lock, stale);
          await rm(stale, { recursive: true, force: true });
        } catch (race) {
          if ((race as NodeJS.ErrnoException).code !== "ENOENT") throw race;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!acquired) throw new Error(`Loop state is busy: ${path.basename(file)}`);
  const heartbeat = setInterval(() => {
    const now = new Date();
    void utimes(lock, now, now).catch(() => {});
  }, 5_000);
  heartbeat.unref();
  const assertOwner = async () => {
    if (await readFile(path.join(lock, "owner"), "utf8") !== token) {
      throw new Error("Loop state lock expired during update");
    }
  };
  try {
    const result = await operation(assertOwner);
    await assertOwner();
    return result;
  } finally {
    clearInterval(heartbeat);
    try {
      if (await readFile(path.join(lock, "owner"), "utf8") === token) {
        await rm(lock, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function updateLocked<T>(file: string, update: (current: T) => Promise<T>): Promise<T> {
  return withFileLock(file, async (assertOwner) => {
    const current = JSON.parse(await readFile(file, "utf8")) as T;
    const next = await update(current);
    await assertOwner();
    await atomicReplace(file, next);
    return next;
  });
}

export async function initRun(qaRoot: string, identity: RunIdentity, refs: RunRefs, now = new Date()): Promise<RunRecord> {
  const root = await rootPath(qaRoot);
  validateIdentity(identity);
  assertRunChild(identity.runRoot, refs.taskModel);
  await existingRef(root, identity.runRoot, "directory");
  await checkedRefs(root, refs);
  await existingRef(root, refs.taskModel);
  const directory = await registry(root, "runs");
  const record: RunRecord = {
    schemaVersion: 1, runId: identity.runId, runRoot: identity.runRoot,
    journeyKey: identity.journeyKey, mode: identity.mode,
    scope: identity.scope, executorId: identity.executorId,
    ...(identity.parentRunId ? { parentRunId: identity.parentRunId } : {}),
    ...(identity.laneOf ? { laneOf: identity.laneOf, lane: identity.lane } : {}),
    ...(identity.lanes ? { lanes: identity.lanes } : {}),
    refs, phase: "planned",
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  if (identity.laneOf) await assertLaneRegistration(root, identity);
  await atomicCreate(path.join(directory, `${identity.runId}.json`), record);
  return record;
}

/** A lane run joins a merged run of the same ticket/PR, environment and SHA, under one of the labels it declared. */
async function assertLaneRegistration(root: string, identity: RunIdentity): Promise<void> {
  let merged: RunRecord;
  try { merged = await inspectRun(root, identity.laneOf!); }
  catch { throw new Error(`Merged run ${identity.laneOf} is not registered; register it first (loop:state init --lanes ...)`); }
  if (!merged.lanes?.includes(identity.lane!)) {
    throw new Error(`Merged run ${merged.runId} declares lanes ${(merged.lanes ?? []).join(", ") || "(none)"}, not ${identity.lane}`);
  }
  if (!["planned", "executing", "changes_requested"].includes(merged.phase)) {
    throw new Error(`Merged run ${merged.runId} is ${merged.phase}; it no longer accepts lane runs`);
  }
  for (const name of ["feature", "environment", "deploymentSha"] as const) {
    if (merged.scope[name] !== identity.scope[name]) {
      throw new Error(`Lane ${name} (${identity.scope[name]}) differs from the merged run (${merged.scope[name]}); one report never mixes ${name}s`);
    }
  }
  for (const name of ["role", "orgAlias"] as const) {
    if (merged.scope[name] !== MERGED_SCOPE_MIXED && merged.scope[name] !== identity.scope[name]) {
      throw new Error(`Lane ${name} (${identity.scope[name]}) differs from the merged run (${merged.scope[name]}); register the merged run with ${MERGED_SCOPE_MIXED} when lanes use different accounts`);
    }
  }
  if (merged.journeyKey !== identity.journeyKey || merged.mode !== identity.mode ||
      parseRunRoot(merged.runRoot).featureRoot !== parseRunRoot(identity.runRoot).featureRoot) {
    throw new Error("A lane shares its merged run's journeyKey, mode and feature directory");
  }
  const taken = (await listLaneRuns(root, merged.runId)).find((run) => run.lane === identity.lane);
  if (taken) throw new Error(`Lane ${identity.lane} of ${merged.runId} is already registered by run ${taken.runId}`);
}

/** Lane runs registered for a merged run. */
export async function listLaneRuns(qaRoot: string, mergedRunId: string): Promise<RunRecord[]> {
  const root = await rootPath(qaRoot);
  const directory = await registry(root, "runs");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const runs = await Promise.all(files.map(async (name) => parseRun(JSON.parse(await readFile(path.join(directory, name), "utf8")))));
  return runs.filter((run) => run.laneOf === key(mergedRunId, "runId")).sort((a, b) => a.lane!.localeCompare(b.lane!));
}

/** Every declared lane has exactly one registered run, in one of `phases`. */
function assertLanesInPhases(merged: RunRecord, registered: readonly RunRecord[], phases: readonly RunPhase[]): void {
  for (const label of merged.lanes ?? []) {
    const lane = registered.find((run) => run.lane === label);
    if (!lane) throw new Error(`Lane ${label} of merged run ${merged.runId} has no registered run`);
    if (!phases.includes(lane.phase)) {
      throw new Error(`Lane ${label} (${lane.runId}) is ${lane.phase}; every lane must be ${phases.join(" or ")} first`);
    }
  }
}

/** The merged packet's lanes are exactly the registered lane runs, unchanged and settled. */
function assertPacketLanes(merged: RunRecord, registered: readonly RunRecord[], packetLanes: readonly CheckerLane[]): void {
  if (packetLanes.length !== (merged.lanes ?? []).length ||
      packetLanes.some((lane) => !(merged.lanes ?? []).includes(lane.lane))) {
    throw new Error("Checker packet lanes differ from the lanes this merged run declares");
  }
  assertLanesInPhases(merged, registered, ["awaiting_review", "reviewed", "published"]);
  for (const lane of packetLanes) {
    const run = registered.find((item) => item.lane === lane.lane)!;
    if (run.runId !== lane.runId || run.runRoot !== lane.runRoot || run.executorId !== lane.executorId ||
        Object.entries(run.scope).some(([name, value]) => lane.scope[name as keyof RunIdentity["scope"]] !== value)) {
      throw new Error(`Checker packet lane ${lane.lane} differs from its registered run`);
    }
  }
}

export async function inspectRun(qaRoot: string, runId: string): Promise<RunRecord> {
  const root = await rootPath(qaRoot);
  const file = path.join(await registry(root, "runs"), `${key(runId, "runId")}.json`);
  return parseRun(JSON.parse(await readFile(file, "utf8")));
}

export async function checkpointRun(
  qaRoot: string, runId: string, executorId: string, phase: RunPhase,
  options: { refs?: Partial<RunRefs>; recoveryRef?: string } = {}, now = new Date(),
): Promise<RunRecord> {
  const root = await rootPath(qaRoot);
  const file = path.join(await registry(root, "runs"), `${key(runId, "runId")}.json`);
  key(executorId, "executorId");
  if (!runPhases.includes(phase)) throw new Error("Invalid run phase");
  return updateLocked(file, async (value) => {
    const record = parseRun(value);
    if (record.executorId !== executorId) throw new Error("Run executor identity cannot change");
    if (!phaseTransitions[record.phase].includes(phase)) throw new Error(phaseTransitionError(record.phase, phase, runId, executorId));
    const refs = { ...record.refs, ...options.refs };
    await checkedRefs(root, refs);
    for (const [name, ref] of Object.entries(options.refs ?? {})) {
      if (name !== "report") assertRunChild(record.runRoot, ref);
      await existingRef(root, ref, name === "bundle" ? "directory" : "file");
    }
    if (record.phase === "reviewed" && phase === "published" &&
        Object.entries(options.refs ?? {}).some(([name, ref]) =>
          !["bundle", "delivery"].includes(name) && record.refs[name as keyof RunRefs] !== ref)) {
      throw new Error("Published run cannot change independently reviewed references");
    }
    if (record.laneOf && phase === "awaiting_review") {
      await existingRef(root, laneCloseoutRef(record.runRoot));
    }
    if (record.lanes && phase === "awaiting_review") {
      assertLanesInPhases(record, await listLaneRuns(root, record.runId), ["awaiting_review", "reviewed", "published"]);
    }
    if (record.laneOf && (phase === "reviewed" || phase === "published")) {
      // A lane has no summary review of its own: it is reviewed and published together with its merged run.
      const merged = await inspectRun(root, record.laneOf);
      if (!(phase === "reviewed" ? ["reviewed", "published"] : ["published"]).includes(merged.phase)) {
        throw new Error(`Lane run ${record.runId} follows merged run ${merged.runId} (${merged.phase}); it can be ${phase} only after the merged run is`);
      }
      return { ...record, refs, phase, updatedAt: now.toISOString() };
    }
    const candidate: RunRecord = { ...record, refs, phase };
    if (phase === "reviewed") {
      const { review } = await checkedReview(root, candidate);
      if (review.caseReviews.some((entry) => entry.disposition !== "upheld")) {
        throw new Error("A challenged Case requires changes_requested and a new review");
      }
    }
    if (phase === "published") {
      if (!refs.bundle) throw new Error("Published run needs a reviewed report bundle");
      const { packet, gate } = await checkedReview(root, candidate, refs.bundle);
      if (!gate.artifactPublishable) throw new Error("Independent checker did not approve Artifact publication");
      if ((packet as CheckerPacket & { bundleDir?: string }).bundleDir !== refs.bundle) {
        throw new Error("Delivered bundle differs from the frozen checker packet");
      }
      if (refs.report !== packet.refs.report) throw new Error("Delivered report differs from reviewed report reference");
      if (!refs.checkerPacket || !refs.checkerReview) {
        throw new Error("Published run needs the registered checker packet and review");
      }
      try {
        await existingRef(root, `.qa-loop/omissions/${record.runId}/plan.json`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error("Published run requires a frozen omission plan from its planned phase");
        }
        throw error;
      }
      // Omission validation reads the current registry, so load it only after the reviewed references are fixed.
      const { checkOmissionApproval } = await import("./omission");
      const omission = await checkOmissionApproval(root, record.runId, refs.checkerPacket, refs.checkerReview);
      if (!omission.artifactPublishable) {
        const blockers = new Set([
          ...omission.requiredNotCoveredKeys,
          ...omission.missingPlannedCaseKeys,
          ...omission.plannedCaseCategoryMismatchKeys,
          ...omission.plannedCaseLaneMismatchKeys,
          ...omission.plannedApplicableNotPassedKeys,
          ...omission.unadjudicatedUnassignedMechanismKeys,
          ...omission.unadjudicatedBlindMechanismKeys,
          ...omission.unadjudicatedFindingIds,
          ...(omission.prInventoryUnverified ? ["PR change inventory unverified"] : []),
          ...(omission.prPlanChangedAfterFreeze ? ["PR task model changed after plan freeze"] : []),
        ]);
        throw new Error(`Omission gate did not approve Artifact publication: ${
          [...blockers].join(", ") || "plan or Case coverage is incomplete"}`);
      }
      await checkedDelivery(root, candidate, packet);
    }
    if (record.phase === "interrupted" && phase !== "interrupted") {
      if (!options.recoveryRef) throw new Error("Interrupted run requires read-only side-effect reconciliation reference");
      assertRunChild(record.runRoot, options.recoveryRef);
      await existingRef(root, options.recoveryRef);
    }
    return {
      ...record, refs, phase, updatedAt: now.toISOString(),
      ...(phase === "interrupted" ? { recoveryRequired: true } : {}),
      ...(record.phase === "interrupted" && phase !== "interrupted"
        ? { recoveryRequired: false, recoveryRef: options.recoveryRef } : {}),
    };
  });
}

export async function heartbeatRun(qaRoot: string, runId: string, executorId: string, now = new Date()): Promise<RunRecord> {
  const root = await rootPath(qaRoot);
  const file = path.join(await registry(root, "runs"), `${key(runId, "runId")}.json`);
  key(executorId, "executorId");
  return updateLocked(file, async (value) => {
    const run = parseRun(value);
    if (run.executorId !== executorId || run.phase !== "executing") {
      throw new Error("Only the executing run owner can refresh its heartbeat");
    }
    return { ...run, updatedAt: now.toISOString() };
  });
}

export async function reconcileRun(
  qaRoot: string, runId: string, olderThanMs: number, confirmedInactive: boolean, now = new Date(),
): Promise<RunRecord> {
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw new Error("Invalid stale-run threshold");
  if (!confirmedInactive) throw new Error("Confirm the executor/E2B is inactive before interrupting a stale run");
  const root = await rootPath(qaRoot);
  const file = path.join(await registry(root, "runs"), `${key(runId, "runId")}.json`);
  return updateLocked(file, async (value) => {
    const run = parseRun(value);
    if (run.phase !== "executing" || now.getTime() - Date.parse(run.updatedAt) < olderThanMs) return run;
    return { ...run, phase: "interrupted", recoveryRequired: true, updatedAt: now.toISOString() };
  });
}

export async function listComparableRuns(qaRoot: string, baselineRunId: string): Promise<RunRecord[]> {
  const baseline = await inspectRun(qaRoot, baselineRunId);
  const root = await rootPath(qaRoot);
  const directory = await registry(root, "runs");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const runs = await Promise.all(files.map(async (name) => parseRun(JSON.parse(await readFile(path.join(directory, name), "utf8")))));
  // Lane runs are partial scopes of a merged run: they compare only with the same lane of another merged run.
  return runs.filter((run) => run.runId !== baseline.runId && run.journeyKey === baseline.journeyKey &&
    (run.laneOf === undefined) === (baseline.laneOf === undefined) && run.lane === baseline.lane &&
    run.mode === baseline.mode && run.scope.environment === baseline.scope.environment &&
    run.scope.role === baseline.scope.role && run.scope.orgAlias === baseline.scope.orgAlias)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addFollowup(qaRoot: string, input: FollowupInput, now = new Date()): Promise<Followup> {
  const root = await rootPath(qaRoot);
  key(input.gapId, "gapId"); key(input.journeyKey, "journeyKey"); key(input.mechanismKey, "mechanismKey");
  if (!gapKinds.has(input.kind)) throw new Error("Invalid gap kind");
  if (input.kind === "action_miss") key(input.intentKey, "intentKey");
  else if (input.intentKey) throw new Error("Only Action misses have an intentKey");
  key(input.source.runId, "source.runId"); key(input.source.caseId, "source.caseId");
  if (!Array.isArray(input.prerequisites)) throw new Error("Invalid prerequisites");
  input.prerequisites.forEach((item) => key(item, "prerequisite"));
  key(input.nextTrigger, "nextTrigger");
  await existingRef(root, input.source.ref);
  const sourceRun = await inspectRun(root, input.source.runId);
  assertRunChild(sourceRun.runRoot, input.source.ref);
  if (sourceRun.journeyKey !== input.journeyKey) throw new Error("Followup journey differs from source run");
  const directory = await registry(root, "followups");
  const gap: Followup = {
    schemaVersion: 1, gapId: input.gapId, journeyKey: input.journeyKey, mechanismKey: input.mechanismKey,
    kind: input.kind, ...(input.intentKey ? { intentKey: input.intentKey } : {}),
    source: { runId: input.source.runId, caseId: input.source.caseId, ref: input.source.ref },
    prerequisites: input.prerequisites, nextTrigger: input.nextTrigger,
    status: "open", createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  await atomicCreate(path.join(directory, `${input.gapId}.json`), gap);
  return gap;
}

export async function inspectFollowup(qaRoot: string, gapId: string): Promise<Followup> {
  const root = await rootPath(qaRoot);
  const file = path.join(await registry(root, "followups"), `${key(gapId, "gapId")}.json`);
  return parseFollowup(JSON.parse(await readFile(file, "utf8")));
}

export async function listFollowups(qaRoot: string, journeyKey?: string): Promise<Followup[]> {
  if (journeyKey) key(journeyKey, "journeyKey");
  const root = await rootPath(qaRoot);
  const directory = await registry(root, "followups");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const gaps = await Promise.all(files.map(async (name) => parseFollowup(JSON.parse(await readFile(path.join(directory, name), "utf8")))));
  return gaps.filter((gap) => !journeyKey || gap.journeyKey === journeyKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.gapId.localeCompare(b.gapId));
}

export async function claimFollowup(
  qaRoot: string, gapId: string, runId: string, executorId: string, leaseMs = 60 * 60_000, now = new Date(),
): Promise<Followup> {
  if (!Number.isInteger(leaseMs) || leaseMs < 60_000 || leaseMs > 24 * 60 * 60_000) throw new Error("Invalid claim lease");
  const root = await rootPath(qaRoot);
  const run = await inspectRun(root, runId);
  if (run.executorId !== executorId) throw new Error("Only the run executor can claim a gap");
  const file = path.join(await registry(root, "followups"), `${key(gapId, "gapId")}.json`);
  return updateLocked(file, async (value) => {
    const gap = parseFollowup(value);
    if (gap.journeyKey !== run.journeyKey) throw new Error("Followup belongs to another journey");
    if (gap.source.runId === runId) throw new Error("A gap must be validated in a subsequent independent run");
    if (gap.status !== "open" && !(gap.status === "claimed" && gap.claim &&
      (Date.parse(gap.claim.expiresAt) <= now.getTime() ||
       (gap.claim.runId === runId && gap.claim.executorId === executorId)))) {
      throw new Error("Followup is already claimed or resolved");
    }
    return {
      ...gap, status: "claimed", claim: { runId, executorId, expiresAt: new Date(now.getTime() + leaseMs).toISOString() },
      updatedAt: now.toISOString(),
    };
  });
}

export async function resolveFollowup(
  qaRoot: string, gapId: string, runId: string, executorId: string,
  resolution: { kind: "validated" | "retired"; caseId: string; ref: string; reason?: string }, now = new Date(),
): Promise<Followup> {
  const root = await rootPath(qaRoot);
  const run = await inspectRun(root, runId);
  if (run.executorId !== executorId) throw new Error("Only the run executor can resolve a gap");
  key(resolution.caseId, "resolution.caseId");
  if (!["validated", "retired"].includes(resolution.kind)) throw new Error("Invalid resolution kind");
  if (resolution.reason) key(resolution.reason, "resolution.reason");
  if (resolution.kind === "retired" && !resolution.reason) throw new Error("Retirement needs a reason code");
  await existingRef(root, resolution.ref);
  // A lane is reviewed through its merged run: the frozen evidence is the merged copy of the lane's files.
  const reviewRun = run.laneOf ? await inspectRun(root, run.laneOf) : run;
  assertRunChild(reviewRun.runRoot, resolution.ref);
  if (reviewRun.phase !== "reviewed" && reviewRun.phase !== "published") {
    throw new Error("Followup validation needs an independently reviewed run");
  }
  const { packet, review } = await checkedReview(root, reviewRun);
  const ownLane = run.laneOf ? packet.lanes?.find((lane) => lane.runId === run.runId) : undefined;
  if (run.laneOf && !ownLane) throw new Error("Lane run is not part of its merged run's reviewed packet");
  const gap = await inspectFollowup(root, gapId);
  const numericCaseId = /^case-([1-9]\d*)$/.exec(resolution.caseId);
  if (!numericCaseId) throw new Error("Resolution caseId must be case-N from the reviewed packet");
  const caseId = Number(numericCaseId[1]);
  if (ownLane && !ownLane.caseIds.includes(caseId)) throw new Error("Resolution Case belongs to another lane of the merged run");
  const checkedCase = packet.cases.find((item) => item.id === caseId);
  const caseReview = review.caseReviews.find((item) => item.id === caseId);
  if (!checkedCase || checkedCase.caseKey !== gap.mechanismKey ||
      (resolution.kind === "validated" && (!checkedCase.executed ||
        !["Pass", "ProductFail", "Product bug"].includes(checkedCase.status))) ||
      caseReview?.disposition !== "upheld" || !Object.hasOwn(packet.files, resolution.ref)) {
    throw new Error("Resolution needs an upheld Case with matching mechanism and frozen evidence reference");
  }
  if (resolution.kind === "validated" && gap.kind === "action_miss") {
    // A merged packet has no Action log of its own: the lane's log (frozen through its closeout) proves the hit.
    const actionLogRef = ownLane
      ? parseLaneCloseout(JSON.parse(await readFile(await assertQaRef(root, ownLane.closeout), "utf8")), ownLane).refs.actionLog
      : packet.refs.actionLog;
    if (!actionLogRef || !Object.hasOwn(packet.files, actionLogRef)) {
      throw new Error("An Action miss needs an Action reuse log to prove later reuse");
    }
    const log = parseReuseLog(await readFile(await assertQaRef(root, actionLogRef), "utf8"));
    if (!log.events.some((event) => event.caseId === resolution.caseId && event.intentId === gap.intentKey && event.outcome === "hit")) {
      throw new Error("Action miss is not validated by a real hit for the same user intent");
    }
  }
  const file = path.join(await registry(root, "followups"), `${key(gapId, "gapId")}.json`);
  return updateLocked(file, async (value) => {
    const gap = parseFollowup(value);
    if (gap.status !== "claimed" || gap.claim?.runId !== runId || gap.claim.executorId !== executorId ||
        Date.parse(gap.claim.expiresAt) <= now.getTime()) throw new Error("Followup claim is absent or expired");
    return {
      ...gap, status: resolution.kind, claim: undefined,
      resolution: { ...resolution, runId }, updatedAt: now.toISOString(),
    };
  });
}
