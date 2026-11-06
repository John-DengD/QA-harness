import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isNonCasePhase, parseReuseLog, type ReuseEvent } from "../tools/action-index";
import { readActionInvocationFact } from "../tools/action-invocation";
import { assertDriftRepairRecorded } from "./drift-gate";
import { parseRunRoot } from "./run-root";

export const caseStatuses = [
  "Pass", "ProductFail", "Product bug", "Blocked", "Inconclusive",
  "Automation failure", "Environment", "Documentation drift", "UX observation",
  "Requirement conflict", "NotRun", "NotApplicable", "SkippedByConstraint",
] as const;
export type CaseStatus = typeof caseStatuses[number];

export interface CheckerCase {
  id: number;
  caseKey: string;
  category: "happy" | "negative" | "edge";
  riskMechanism: string;
  expected: {
    sourceKind: "ticket" | "user" | "active_model" | "pr_spec";
    sourceRef: string;
    anchor: string;
    appliesWhen: string;
    evidenceRefs: string[];
  }[];
  status: CaseStatus;
  applicable: boolean;
  executed: boolean;
  evidenceRefs: string[];
  reason?: string;
  resumeCondition?: string;
}

export interface CheckerDraft {
  schemaVersion: 1;
  runId: string;
  executorId: string;
  journeyKey: string;
  mode: "new" | "regression";
  scope: {
    feature: string;
    environment: string;
    role: string;
    orgAlias: string;
    deploymentSha: string;
  };
  runRoot: string;
  evidenceDir: string;
  bundleDir: string;
  refs: {
    taskModel: string;
    actionLog?: string;
    caseHarvest: string;
    videoManifest: string;
    runState: string;
    report: string;
    cleanup: string;
  };
  reportOutcome: "通过" | "不通过";
  cleanup: { state: "verified" | "residual" | "unknown"; actionUnknown: boolean; reason?: string };
  cases: CheckerCase[];
  /**
   * Incremental mode: one entry per executed Case, pointing at the latest frozen Case packet and its
   * independent Case review under `RUN_ROOT/run-state/checker/`. Omitted/empty = whole-run review.
   */
  caseReviews?: CaseReviewLink[];
  /**
   * Merged run: the lane runs whose Cases this one summary covers. Each Case belongs to exactly one lane, its
   * Case packet/review live in that lane's `run-state/checker/`, and its evidence is copied (byte for byte) under
   * `<runRoot>/evidence/lanes/<laneRunId>/`. Produced by `qa:checker merge`; the merged run executes no Case.
   */
  lanes?: CheckerLane[];
}

export interface CheckerLane {
  /** Lane label declared by the merged run (`loop:state init --lanes`). */
  lane: string;
  runId: string;
  runRoot: string;
  executorId: string;
  /** The lane's own scope: feature/environment/deploymentSha equal the merged scope, role/orgAlias may differ. */
  scope: CheckerDraft["scope"];
  /** Case IDs owned by this lane; disjoint across lanes and together exactly the merged Cases. */
  caseIds: number[];
  /** `<laneRunRoot>/run-state/lane-closeout.json` (frozen into the merged packet). */
  closeout: string;
}

/** `RUN_ROOT/run-state/lane-closeout.json`: what a finished lane hands to the merge. */
export interface LaneCloseout {
  schemaVersion: 1;
  kind: "lane_closeout";
  runId: string;
  executorId: string;
  lane: string;
  evidenceDir: string;
  refs: { videoManifest: string; caseHarvest: string; cleanup: string; actionLog?: string };
  cleanup: CheckerDraft["cleanup"];
  /** Every planned Case of this lane, executed or not (executed ones must match their latest Case packet). */
  cases: CheckerCase[];
}

export interface CaseReviewLink {
  caseId: number;
  /** QA_ROOT-relative `RUN_ROOT/run-state/checker/case-<N>[.r<k>].packet.json` */
  packet: string;
  /** QA_ROOT-relative `RUN_ROOT/run-state/checker/case-<N>[.r<k>].review.json` */
  review: string;
}

export type CaseSideEffectState = "none" | "cleaned" | "pending_cleanup" | "residual" | "unknown";

/** Input for `qa:checker freeze-case`: one settled, executed Case. */
export interface CaseCheckerDraft {
  schemaVersion: 1;
  kind: "case";
  runId: string;
  executorId: string;
  runRoot: string;
  scope: CheckerDraft["scope"];
  case: CheckerCase;
  refs: {
    caseHarvest: string;
    video: string;
    screenshots: string[];
    facts: string[];
    actionLog?: string;
  };
  sideEffects: { state: CaseSideEffectState; actionUnknown: boolean; reason?: string };
  /** Optional data dependencies from the task model: start state it needs, state it creates, shared state it changes. */
  data?: CaseData;
  /** Set when this packet replaces an earlier packet of the same Case after a re-execution. */
  rerun?: CaseRerun;
}

export interface CaseData {
  requires: string[];
  produces: string[];
  /** Reversible state must name its `undo` (Action `undoneBy` or page operation); irreversible state has none. */
  mutates: { state: string; reversible: boolean; undo?: string }[];
}

export interface CaseRerun {
  reason: string;
  /** Read-only check that the Case's `requires` held again before the rerun. */
  preconditionCheck: string;
  /** QA_ROOT-relative evidence of that check; each must be one of this Case's frozen screenshots or facts. */
  preconditionEvidence: string[];
  /** QA_ROOT-relative path of the replaced, lower-revision packet of the same Case. */
  fromPacket: string;
}

export interface CaseCheckerPacket extends CaseCheckerDraft {
  /** Only this Case's evidence: Expected snapshots, video, screenshots, facts and its Action invocation facts. */
  files: Record<string, { sha256: string; size: number }>;
  /** Digest of this Case's entries in the shared Action log (other Cases may keep appending). */
  actionEntries?: { count: number; sha256: string };
  digest: string;
}

export interface CaseCheckerReview {
  schemaVersion: 1;
  kind: "case";
  runId: string;
  reviewerId: string;
  packetDigest: string;
  caseId: number;
  disposition: "upheld" | "downgrade" | "insufficient";
  reason: string;
  suggestedStatus?: CaseStatus;
  /** Systemic issues the executor must apply to later Cases. */
  feedback?: string[];
}

export interface CaseReviewResult {
  runId: string;
  caseId: number;
  packetDigest: string;
  reviewerId: string;
  disposition: CaseCheckerReview["disposition"];
  upheld: boolean;
  feedback: string[];
}

export type CaseReviewState = "not_frozen" | "pending_review" | "upheld" | "needs_fix" | "invalidated" | "not_required";

export interface CaseReviewStatus {
  runRoot: string;
  cases: {
    caseId: number;
    state: CaseReviewState;
    revision?: number;
    packet?: string;
    review?: string;
    reason?: string;
    feedback?: string[];
  }[];
}

export interface CheckerPacket extends CheckerDraft {
  files: Record<string, { sha256: string; size: number }>;
  digest: string;
}

export interface CheckerReview {
  schemaVersion: 1;
  runId: string;
  reviewerId: string;
  packetDigest: string;
  caseReviews: {
    id: number;
    disposition: "upheld" | "downgrade" | "insufficient";
    reason: string;
    suggestedStatus?: CaseStatus;
  }[];
  qaApprovalEligible: boolean;
  artifactPublishable: boolean;
  reasons: string[];
}

export interface CheckerGate {
  runId: string;
  packetDigest: string;
  qaApprovalEligible: boolean;
  artifactPublishable: boolean;
  reasons: string[];
}

type ManifestScreenshot = { path: string; caption: string };
type ManifestCase = { id: number; status: CaseStatus; executed: boolean; video?: string; screenshots?: ManifestScreenshot[] };

const screenshotExtensions = [".png", ".jpg", ".jpeg", ".webp"];
const bundleRootMessage = "Artifact bundle must contain only index.html, qa-report.md, screenshots/ and videos/ (screenshots/ only when Cases have screenshots)";

/** Bundled screenshot names follow `screenshots/case-<N>-<k>.<ext>` in manifest order. */
function bundledScreenshots(item: ManifestCase): { original: string; name: string }[] {
  return (item.screenshots ?? []).map((shot, index) => ({
    original: shot.path, name: `case-${item.id}-${index + 1}${path.posix.extname(shot.path).toLowerCase()}`,
  }));
}

function expectedBundleRoot(manifest: ManifestCase[]): string {
  return manifest.some((item) => item.screenshots?.length)
    ? "index.html,qa-report.md,screenshots,videos" : "index.html,qa-report.md,videos";
}

const decisiveStatuses: readonly CaseStatus[] = ["Pass", "ProductFail", "Product bug"];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty`);
  return value.trim();
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => nonempty(item, `${label}[${index}]`));
}

function relative(value: unknown, label: string): string {
  const name = nonempty(value, label);
  if (path.isAbsolute(name) || name.includes("\\") || name.includes("\0") || /(^|\/)\.\.?($|\/)/.test(name) || name.includes(":") || path.posix.normalize(name) !== name) {
    throw new Error(`${label} must be a normalized QA_ROOT-relative path`);
  }
  return name;
}

function runChild(value: string, runRoot: string, label: string): void {
  if (!value.startsWith(`${runRoot}/`)) throw new Error(`${label} must belong to the current runRoot`);
}

function noSecrets(value: unknown): void {
  const strings = (item: unknown): string[] => {
    if (typeof item === "string") return [item];
    if (Array.isArray(item)) return item.flatMap(strings);
    if (item && typeof item === "object") return Object.entries(item).flatMap(([key, entry]) => [key, ...strings(entry)]);
    return [];
  };
  const serialized = [JSON.stringify(value), ...strings(value)].join("\n");
  if (/(?:\bBearer\s+[\w.-]{12,}|\bsk_(?:test|live)_[\w-]{8,}|\bsk-[\w-]{16,}|\b(?:E2B_API_KEY|STAGING_E2E_ADMIN_TOKEN|CLERK_SECRET_KEY)["']?\s*[:=]\s*["']?[^\s,"'}]{8,}|\b(?:OTP|email code|verification code|验证码)\s*[:：=]\s*\d{4,8}\b|[?&](?:ticket|token|code)=[^\s&"']+)/i.test(serialized)) {
    throw new Error("Checker packet contains a likely credential or signed URL");
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function rootPath(qaRoot: string): Promise<string> {
  const root = await realpath(qaRoot);
  if (!(await stat(root)).isDirectory()) throw new Error("QA_ROOT must be a directory");
  return root;
}

export async function checkedPath(qaRoot: string, value: string, kind: "file" | "directory" = "file"): Promise<string> {
  const root = await rootPath(qaRoot);
  const name = relative(value, "reference");
  let current = root;
  for (const component of name.split("/")) {
    current = path.join(current, component);
    const meta = await lstat(current);
    if (meta.isSymbolicLink()) throw new Error(`Symlink is not permitted in checker reference: ${name}`);
  }
  const actual = await realpath(current);
  if (!actual.startsWith(`${root}${path.sep}`)) throw new Error(`Reference leaves QA_ROOT: ${name}`);
  const meta = await stat(actual);
  if (kind === "file" && !meta.isFile()) throw new Error(`Reference must be a regular file: ${name}`);
  if (kind === "directory" && !meta.isDirectory()) throw new Error(`Reference must be a directory: ${name}`);
  return actual;
}

export async function checkedOutputPath(qaRoot: string, value: string): Promise<string> {
  const root = await rootPath(qaRoot);
  const name = relative(value, "output");
  const parent = path.posix.dirname(name);
  if (parent === ".") return path.join(root, name);
  await checkedPath(root, parent, "directory");
  return path.join(root, name);
}

export async function hashFile(qaRoot: string, value: string): Promise<{ sha256: string; size: number }> {
  const file = await checkedPath(qaRoot, value);
  const before = await stat(file);
  if (!before.size) throw new Error(`Evidence file is empty: ${value}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Evidence changed while freezing: ${value}`);
  return { sha256: hash.digest("hex"), size: after.size };
}

function normalizeCase(item: unknown, index: number): CheckerCase {
    const entry = object(item, `Case ${index}`);
    if (!Number.isSafeInteger(entry.id) || (entry.id as number) < 1) throw new Error("Case ID must be a positive integer");
    if (!Array.isArray(entry.expected)) throw new Error(`Case ${entry.id} needs an Expected array`);
    const expected = entry.expected.map((item, expectedIndex) => {
      const atom = object(item, `Case ${entry.id} Expected ${expectedIndex}`);
      return {
        sourceKind: oneOf(atom.sourceKind, ["ticket", "user", "active_model", "pr_spec"] as const, "Expected source"),
        sourceRef: relative(atom.sourceRef, "Expected snapshot"),
        anchor: nonempty(atom.anchor, "Expected anchor"),
        appliesWhen: nonempty(atom.appliesWhen, "Expected appliesWhen"),
        evidenceRefs: stringList(atom.evidenceRefs, "Expected evidence").map((ref) => relative(ref, "Expected evidence")),
      };
    });
    const status = oneOf(entry.status, caseStatuses, `Case ${entry.id} status`);
    if (decisiveStatuses.includes(status) && !expected.length) {
      throw new Error(`Case ${entry.id} cannot claim ${status} without authoritative Expected`);
    }
    const applicable = boolean(entry.applicable, `Case ${entry.id} applicable`);
    const executed = boolean(entry.executed, `Case ${entry.id} executed`);
    if (applicable === (status === "NotApplicable")) throw new Error(`Case ${entry.id} NotApplicable disagrees with applicability`);
    if (executed && ["NotRun", "NotApplicable", "SkippedByConstraint"].includes(status)) throw new Error(`Case ${entry.id} cannot be ${status} after execution`);
    if (!executed && ["Pass", "ProductFail", "Product bug", "Automation failure"].includes(status)) throw new Error(`Case ${entry.id} needs execution for ${status}`);
    const reason = entry.reason === undefined ? undefined : nonempty(entry.reason, `Case ${entry.id} reason`);
    if (!expected.length && !reason) throw new Error(`Case ${entry.id} with unknown Expected needs an explicit reason`);
    if (!executed && !reason) throw new Error(`Unexecuted Case ${entry.id} needs a reason`);
    const resumeCondition = entry.resumeCondition === undefined ? undefined : nonempty(entry.resumeCondition, `Case ${entry.id} resumeCondition`);
    if (status === "Blocked" && !resumeCondition) throw new Error(`Blocked Case ${entry.id} needs a resumeCondition`);
    const evidenceRefs = stringList(entry.evidenceRefs, `Case ${entry.id} evidence`).map((ref) => relative(ref, "Case evidence"));
    if (executed && !evidenceRefs.length) throw new Error(`Executed Case ${entry.id} needs evidence`);
    return {
      id: entry.id as number, caseKey: nonempty(entry.caseKey, "caseKey"),
      category: oneOf(entry.category, ["happy", "negative", "edge"] as const, "Case category"),
      riskMechanism: nonempty(entry.riskMechanism, "riskMechanism"), expected, status,
      applicable, executed, evidenceRefs,
      ...(reason ? { reason } : {}), ...(resumeCondition ? { resumeCondition } : {}),
    };
}

function scopeOf(value: unknown): CheckerDraft["scope"] {
  const scope = object(value, "scope");
  return {
    feature: nonempty(scope.feature, "feature"),
    environment: nonempty(scope.environment, "environment"),
    role: nonempty(scope.role, "role"),
    orgAlias: nonempty(scope.orgAlias, "orgAlias"),
    deploymentSha: nonempty(scope.deploymentSha, "deploymentSha"),
  };
}

function checkRunIdentity(runId: string, feature: string, runRoot: string): void {
  for (const [label, value] of [["runId", runId], ["feature", feature]] as const) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value) || value === "." || value === "..") {
      throw new Error(`${label} must be a safe directory identifier`);
    }
  }
  // Shared rule (run-root.ts): [<surface>/]<feature>/runs/<runId>, all QA_ROOT-relative.
  parseRunRoot(runRoot, { feature, runId });
}

function checkCasePaths(entry: CheckerCase, runRoot: string): void {
  for (const ref of entry.evidenceRefs) runChild(ref, runRoot, `Case ${entry.id} evidence`);
  for (const expected of entry.expected) {
    if (expected.sourceKind === "pr_spec" &&
        (expected.sourceRef !== `${runRoot}/tickets/pr-spec.json`)) {
      throw new Error(`Case ${entry.id} PR Expected needs this run's frozen PR spec snapshot`);
    }
    for (const ref of expected.evidenceRefs) runChild(ref, runRoot, `Case ${entry.id} Expected evidence`);
  }
}

function normalizeCaseReviewLinks(value: unknown): CaseReviewLink[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("caseReviews must be an array");
  if (!value.length) return undefined;
  return value.map((item, index) => {
    const link = object(item, `caseReviews[${index}]`);
    if (!Number.isSafeInteger(link.caseId) || (link.caseId as number) < 1) throw new Error("caseReviews caseId must be a positive integer");
    return {
      caseId: link.caseId as number,
      packet: relative(link.packet, "Case packet"),
      review: relative(link.review, "Case review"),
    };
  });
}

function normalizeCleanup(value: unknown): CheckerDraft["cleanup"] {
  const cleanup = object(value, "cleanup");
  const state = oneOf(cleanup.state, ["verified", "residual", "unknown"] as const, "cleanup state");
  const actionUnknown = boolean(cleanup.actionUnknown, "actionUnknown");
  const reason = cleanup.reason === undefined ? undefined : nonempty(cleanup.reason, "cleanup reason");
  if ((state !== "verified" || actionUnknown) && !reason) throw new Error("Unresolved cleanup needs a reason");
  return { state, actionUnknown, ...(reason ? { reason } : {}) };
}

// ---------------------------------------------------------------------------
// Lanes: several lane runs, one merged summary (see references/parallel-e2b.md)
// ---------------------------------------------------------------------------

const laneLabelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
export const MERGED_SCOPE_MIXED = "mixed";

/** `<laneRunRoot>/run-state/lane-closeout.json`. */
export function laneCloseoutRef(laneRunRoot: string): string {
  return path.posix.join(laneRunRoot, "run-state", "lane-closeout.json");
}

/**
 * Where a lane's evidence file sits in the merged run. The merged run's PR spec snapshot stands in for each lane's
 * own `tickets/pr-spec.json` (the merge requires them to be byte-identical); other files under the lane run root
 * are copied to `<mergedRunRoot>/evidence/lanes/<laneRunId>/<same relative path>`; refs outside the lane run root
 * (feature-level snapshots) stay where they are.
 */
export function laneMergedRef(ref: string, lane: { runId: string; runRoot: string }, mergedRunRoot: string): string {
  if (ref === `${lane.runRoot}/tickets/pr-spec.json`) return `${mergedRunRoot}/tickets/pr-spec.json`;
  if (ref.startsWith(`${lane.runRoot}/`)) {
    return `${mergedRunRoot}/evidence/lanes/${lane.runId}/${ref.slice(lane.runRoot.length + 1)}`;
  }
  return ref;
}

/** A lane Case rewritten to merged-run paths; everything but the paths is untouched. */
export function laneMergedCase(entry: CheckerCase, lane: { runId: string; runRoot: string }, mergedRunRoot: string): CheckerCase {
  const map = (ref: string) => laneMergedRef(ref, lane, mergedRunRoot);
  return {
    ...entry,
    expected: entry.expected.map((atom) => ({ ...atom, sourceRef: map(atom.sourceRef), evidenceRefs: atom.evidenceRefs.map(map) })),
    evidenceRefs: entry.evidenceRefs.map(map),
  };
}

function normalizeLanes(value: unknown, draft: CheckerDraft): CheckerLane[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 2) throw new Error("A merged packet needs at least two lanes");
  if (draft.refs.actionLog !== undefined) {
    throw new Error("A merged packet has no Action log of its own; each lane's Action log is frozen through its closeout");
  }
  const { featureRoot } = parseRunRoot(draft.runRoot);
  const lanes = value.map((item, index): CheckerLane => {
    const entry = object(item, `lanes[${index}]`);
    const lane = nonempty(entry.lane, "lane label");
    if (!laneLabelPattern.test(lane)) throw new Error(`Lane label ${lane} must be a short identifier`);
    const runId = nonempty(entry.runId, "lane runId");
    const runRoot = relative(entry.runRoot, "lane runRoot");
    checkRunIdentity(runId, draft.scope.feature, runRoot);
    if (parseRunRoot(runRoot).featureRoot !== featureRoot) {
      throw new Error(`Lane ${lane} must live in the same feature directory as the merged run (${featureRoot})`);
    }
    const scope = scopeOf(entry.scope);
    for (const name of ["feature", "environment", "deploymentSha"] as const) {
      if (scope[name] !== draft.scope[name]) {
        throw new Error(`Lane ${lane} ${name} (${scope[name]}) differs from the merged run (${draft.scope[name]}); lanes of one report share feature, environment and deployment SHA`);
      }
    }
    for (const name of ["role", "orgAlias"] as const) {
      if (draft.scope[name] !== MERGED_SCOPE_MIXED && draft.scope[name] !== scope[name]) {
        throw new Error(`Lane ${lane} ${name} (${scope[name]}) differs from the merged run (${draft.scope[name]}); register the merged run with ${MERGED_SCOPE_MIXED} when lanes use different accounts`);
      }
    }
    if (!Array.isArray(entry.caseIds) || !entry.caseIds.length ||
        entry.caseIds.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(entry.caseIds).size !== entry.caseIds.length) {
      throw new Error(`Lane ${lane} needs unique positive Case IDs`);
    }
    const closeout = relative(entry.closeout, "lane closeout");
    if (closeout !== laneCloseoutRef(runRoot)) throw new Error(`Lane ${lane} closeout must be ${laneCloseoutRef(runRoot)}`);
    return { lane, runId, runRoot, executorId: nonempty(entry.executorId, "lane executorId"), scope,
      caseIds: [...(entry.caseIds as number[])].sort((a, b) => a - b), closeout };
  });
  if (new Set(lanes.map((entry) => entry.lane)).size !== lanes.length || new Set(lanes.map((entry) => entry.runId)).size !== lanes.length) {
    throw new Error("Duplicate lane label or lane runId");
  }
  if (lanes.some((entry) => entry.runId === draft.runId)) throw new Error("A lane cannot be the merged run itself");
  const owned = lanes.flatMap((entry) => entry.caseIds);
  if (new Set(owned).size !== owned.length) throw new Error("A Case ID belongs to more than one lane");
  const caseIds = draft.cases.map((entry) => entry.id).sort((a, b) => a - b);
  if (canonical([...owned].sort((a, b) => a - b)) !== canonical(caseIds)) {
    throw new Error("Lane Case IDs must exactly cover the merged Cases");
  }
  return lanes;
}

/** Parse a lane closeout and check it names the lane it was frozen for. */
export function parseLaneCloseout(input: unknown, lane: Pick<CheckerLane, "runId" | "runRoot" | "executorId" | "lane">): LaneCloseout {
  noSecrets(input);
  const value = object(input, "lane closeout");
  if (value.schemaVersion !== 1 || value.kind !== "lane_closeout") throw new Error("Unsupported lane closeout version or kind");
  if (value.runId !== lane.runId || value.lane !== lane.lane || value.executorId !== lane.executorId) {
    throw new Error(`Lane closeout does not belong to lane ${lane.lane} (${lane.runId})`);
  }
  const refs = object(value.refs, "lane closeout refs");
  const closeoutRef = (name: string, ref: unknown): string => {
    const clean = relative(ref, `lane closeout ${name}`);
    runChild(clean, lane.runRoot, `lane closeout ${name}`);
    return clean;
  };
  const evidenceDir = closeoutRef("evidenceDir", value.evidenceDir);
  const cases = (Array.isArray(value.cases) ? value.cases : []).map(normalizeCase);
  if (!cases.length) throw new Error(`Lane ${lane.lane} closeout lists no Cases`);
  if (new Set(cases.map((entry) => entry.id)).size !== cases.length || new Set(cases.map((entry) => entry.caseKey)).size !== cases.length) {
    throw new Error(`Lane ${lane.lane} closeout has a duplicate Case ID or caseKey`);
  }
  for (const entry of cases) checkCasePaths(entry, lane.runRoot);
  return {
    schemaVersion: 1, kind: "lane_closeout", runId: lane.runId, executorId: lane.executorId, lane: lane.lane, evidenceDir,
    refs: {
      videoManifest: closeoutRef("videoManifest", refs.videoManifest), caseHarvest: closeoutRef("caseHarvest", refs.caseHarvest),
      cleanup: closeoutRef("cleanup", refs.cleanup),
      ...(refs.actionLog === undefined ? {} : { actionLog: closeoutRef("actionLog", refs.actionLog) }),
    },
    cleanup: normalizeCleanup(value.cleanup), cases,
  };
}

/** Worst cleanup state across lanes: any residual/unknown or action_unknown carries into the merged summary. */
export function aggregateLaneCleanup(closeouts: readonly Pick<LaneCloseout, "lane" | "cleanup">[]): CheckerDraft["cleanup"] {
  const rank = { verified: 0, residual: 1, unknown: 2 } as const;
  const state = closeouts.reduce<CheckerDraft["cleanup"]["state"]>(
    (worst, item) => rank[item.cleanup.state] > rank[worst] ? item.cleanup.state : worst, "verified");
  const actionUnknown = closeouts.some((item) => item.cleanup.actionUnknown);
  const reasons = closeouts.filter((item) => item.cleanup.state !== "verified" || item.cleanup.actionUnknown)
    .map((item) => `${item.lane}: ${item.cleanup.reason}`);
  return { state, actionUnknown, ...(reasons.length ? { reason: reasons.join("; ") } : {}) };
}

/** Public so `qa:checker merge` validates its generated input with the same rules `freeze` applies. */
export function normalizeCheckerDraft(input: unknown): CheckerDraft {
  return normalizeDraft(input);
}

function normalizeDraft(input: unknown): CheckerDraft {
  noSecrets(input);
  const draft = object(input, "draft");
  object(draft.scope, "scope");
  const refs = object(draft.refs, "refs");
  const cleanup = object(draft.cleanup, "cleanup");
  if (draft.schemaVersion !== 1) throw new Error("Unsupported checker packet version");
  if (!Array.isArray(draft.cases) || !draft.cases.length) throw new Error("Packet needs at least one planned Case");
  const cases: CheckerCase[] = draft.cases.map(normalizeCase);
  if (new Set(cases.map((entry) => entry.id)).size !== cases.length || new Set(cases.map((entry) => entry.caseKey)).size !== cases.length) {
    throw new Error("Duplicate Case ID or caseKey");
  }
  const { state: cleanupState, actionUnknown, reason: cleanupReason } = normalizeCleanup(cleanup);
  const reportOutcome = oneOf(draft.reportOutcome, ["通过", "不通过"] as const, "report outcome");
  if (reportOutcome === "通过" && (!cases.some((entry) => entry.applicable) ||
    cases.some((entry) => !entry.expected.length) ||
    cases.some((entry) => entry.applicable && entry.status !== "Pass") || cleanupState !== "verified" || actionUnknown)) {
    throw new Error("Overall Pass conflicts with Case verdict or unresolved side effects");
  }
  const normalized: CheckerDraft = {
    schemaVersion: 1,
    runId: nonempty(draft.runId, "runId"),
    executorId: nonempty(draft.executorId, "executorId"),
    journeyKey: nonempty(draft.journeyKey, "journeyKey"),
    mode: oneOf(draft.mode, ["new", "regression"] as const, "mode"),
    scope: scopeOf(draft.scope),
    runRoot: relative(draft.runRoot, "runRoot"),
    evidenceDir: relative(draft.evidenceDir, "evidenceDir"),
    bundleDir: relative(draft.bundleDir, "bundleDir"),
    refs: {
      taskModel: relative(refs.taskModel, "taskModel"),
      ...(refs.actionLog === undefined ? {} : { actionLog: relative(refs.actionLog, "actionLog") }),
      caseHarvest: relative(refs.caseHarvest, "caseHarvest"),
      videoManifest: relative(refs.videoManifest, "videoManifest"),
      runState: relative(refs.runState, "runState"),
      report: relative(refs.report, "report"),
      cleanup: relative(refs.cleanup, "cleanup"),
    },
    reportOutcome,
    cleanup: { state: cleanupState, actionUnknown, ...(cleanupReason ? { reason: cleanupReason } : {}) },
    cases,
  };
  const caseReviews = normalizeCaseReviewLinks(draft.caseReviews);
  if (caseReviews) normalized.caseReviews = caseReviews;
  checkRunIdentity(normalized.runId, normalized.scope.feature, normalized.runRoot);
  const lanes = normalizeLanes(draft.lanes, normalized);
  if (lanes) normalized.lanes = lanes;
  runChild(normalized.evidenceDir, normalized.runRoot, "evidenceDir");
  runChild(normalized.bundleDir, normalized.runRoot, "bundleDir");
  for (const [label, value] of Object.entries(normalized.refs)) {
    if (label === "report") {
      const { featureRoot } = parseRunRoot(normalized.runRoot);
      if (!value.startsWith(`${featureRoot}/`)) throw new Error(`report must belong to the current feature (${featureRoot}/)`);
    } else runChild(value, normalized.runRoot, label);
  }
  for (const entry of normalized.cases) checkCasePaths(entry, normalized.runRoot);
  noSecrets(normalized);
  return normalized;
}

function parseManifest(input: unknown): ManifestCase[] {
  const manifest = object(input, "video manifest");
  if (!Array.isArray(manifest.cases)) throw new Error("Video manifest needs cases");
  return manifest.cases.map((raw) => {
    const entry = object(raw, "video manifest case");
    if (!Number.isSafeInteger(entry.id) || (entry.id as number) < 1) throw new Error("Invalid video manifest Case ID");
    return {
      id: entry.id as number,
      status: oneOf(entry.status, caseStatuses, "video manifest status"),
      executed: boolean(entry.executed, "video manifest executed"),
      ...(entry.video === undefined ? {} : { video: relative(entry.video, "video manifest video") }),
      ...(entry.screenshots === undefined ? {} : { screenshots: parseScreenshots(entry.screenshots, entry.id as number) }),
    };
  });
}

function parseScreenshots(value: unknown, id: number): ManifestScreenshot[] {
  if (!Array.isArray(value)) throw new Error(`Case ${id} screenshots must be an array`);
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const shot = object(raw, `Case ${id} screenshot ${index + 1}`);
    const shotPath = relative(shot.path, "video manifest screenshot");
    if (!screenshotExtensions.includes(path.posix.extname(shotPath).toLowerCase())) {
      throw new Error(`Case ${id} screenshot ${index + 1} must be PNG, JPEG or WebP`);
    }
    if (seen.has(shotPath)) throw new Error(`Case ${id} lists a duplicate screenshot`);
    seen.add(shotPath);
    return { path: shotPath, caption: nonempty(shot.caption, `Case ${id} screenshot caption`) };
  });
}

function normalizedStatus(status: CaseStatus): string {
  return status === "Product bug" ? "ProductFail" : status;
}

async function verifyPrSpecSnapshot(qaRoot: string, sourceRef: string, anchor: string, deploymentSha: string): Promise<void> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(await checkedPath(qaRoot, sourceRef), "utf8")); }
  catch { throw new Error(`PR spec snapshot is not valid JSON: ${sourceRef}`); }
  const snapshot = object(parsed, "PR spec snapshot");
  if (snapshot.kind !== "pr_spec_snapshot" || snapshot.schemaVersion !== 1 ||
      !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/.test(nonempty(snapshot.prUrl, "PR URL")) ||
      !/^[a-f0-9]{40}$/i.test(nonempty(snapshot.baseSha, "PR base SHA")) ||
      !/^[a-f0-9]{40}$/i.test(nonempty(snapshot.headSha, "PR head SHA")) ||
      Number.isNaN(Date.parse(nonempty(snapshot.capturedAt, "PR capturedAt"))) ||
      !Array.isArray(snapshot.statements) || !snapshot.statements.length) {
    throw new Error("PR spec snapshot needs a PR URL, base/head SHA, capture time and prose statements");
  }
  if (!/^[a-f0-9]{40}$/i.test(deploymentSha) || snapshot.headSha !== deploymentSha) {
    throw new Error("PR spec head SHA must match this run's full deployment SHA");
  }
  const statements = snapshot.statements.map((item, index) => {
    const statement = object(item, `PR spec statement ${index}`);
    const source = oneOf(statement.source, ["description", "author_comment"] as const, "PR spec statement source");
    const text = nonempty(statement.text, "PR spec statement text");
    if (source === "author_comment") {
      const commentUrl = nonempty(statement.url, "PR author comment URL");
      if (!commentUrl.startsWith(`${snapshot.prUrl}#`) ||
          !/^#(?:issuecomment-|discussion_r)\d+$/.test(commentUrl.slice((snapshot.prUrl as string).length))) {
        throw new Error("PR author comment needs a direct URL on the same PR");
      }
    }
    return text;
  });
  if (!statements.some((text) => text.includes(anchor))) {
    throw new Error(`PR Expected anchor is absent from frozen PR prose: ${sourceRef}`);
  }
}

function parseActionLog(log: string): ReturnType<typeof parseReuseLog> {
  try { return parseReuseLog(log); }
  catch (error) {
    throw new Error(`Action log is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A read whose silent-drift guard fired is not evidence until the operator settles it against a screenshot. */
function assertNoPendingCrossChecks(pending: readonly ReuseEvent[]): void {
  if (!pending.length) return;
  throw new Error(`Action log has unconfirmed cross-check(s): ${pending.map((event) =>
    `${event.caseId}/${event.intentId} (${event.action})`).join(", ")}. Compare each reading with a Computer Use ` +
    "screenshot, then pnpm action:reuse confirm --log <log> --run-id <id> --case-id <case> --intent-id <intent> --result hit|drift");
}

/** Validate one Action hit against its invocation fact; returns the fact and before/after screenshot refs. */
async function actionHitReferences(
  qaRoot: string, runRootRef: string, actionLog: string, event: ReuseEvent, usedInvocations: Set<string>,
): Promise<string[]> {
  const runRoot = await rootPath(qaRoot);
  const file = path.resolve(path.dirname(path.join(runRoot, actionLog)), event.factRef!);
  const factRef = path.relative(runRoot, file).split(path.sep).join("/");
  relative(factRef, "Action invocation factRef");
  runChild(factRef, runRootRef, "Action invocation factRef");
  if (usedInvocations.has(event.invocationId!)) {
    throw new Error("One Action invocation cannot count as multiple hits");
  }
  usedInvocations.add(event.invocationId!);
  const fact = (await readActionInvocationFact(await checkedPath(qaRoot, factRef), {
    runId: event.runId, caseId: event.caseId, intentId: event.intentId,
    action: event.action!, invocationId: event.invocationId!,
    factRef: event.factRef!, factSha256: event.factSha256!,
    lookupMs: event.lookupMs, executionMs: event.executionMs,
  })).fact;
  if (!factRef.endsWith(`/playwright/actions/${fact.invocationId}.json`) ||
      fact.factPath !== `playwright/actions/${fact.invocationId}.json` ||
      fact.target.origin !== fact.origin ||
      fact.beforeScreenshot !== `${fact.invocationId}-before.png` ||
      fact.target.beforeScreenshot !== `playwright/actions/${fact.beforeScreenshot}` ||
      fact.afterScreenshot !== `${fact.invocationId}-after.png` ||
      fact.target.afterScreenshot !== `playwright/actions/${fact.afterScreenshot}`) {
    throw new Error("Action invocation fact target evidence does not match its Action path");
  }
  const references: string[] = [];
  for (const screenshot of [fact.beforeScreenshot, fact.afterScreenshot]) {
    const screenshotRef = path.posix.join(path.posix.dirname(factRef), screenshot!);
    runChild(screenshotRef, runRootRef, "Action invocation screenshot");
    references.push(screenshotRef);
  }
  references.push(factRef);
  return references;
}

/** A file the merge copied out of a lane run; the copy must stay byte-identical to its lane original. */
export interface LaneCopy { ref: string; laneRef: string }

async function collectReferences(
  qaRoot: string, draft: CheckerDraft,
): Promise<{ references: string[]; laneCopies: LaneCopy[] }> {
  await checkedPath(qaRoot, draft.evidenceDir, "directory");
  await checkedPath(qaRoot, draft.bundleDir, "directory");
  const manifest = parseManifest(JSON.parse(await readFile(await checkedPath(qaRoot, draft.refs.videoManifest), "utf8")));
  const manifestIds = new Set(manifest.map((entry) => entry.id));
  if (manifestIds.size !== draft.cases.length || manifest.length !== draft.cases.length || draft.cases.some((entry) => !manifestIds.has(entry.id))) {
    throw new Error("Video manifest and checker Case IDs differ");
  }
  const references = new Set<string>(Object.values(draft.refs));
  const usedVideos = new Set<string>();
  const bundledVideos: string[] = [];
  const bundledShots: string[] = [];
  for (const entry of draft.cases) {
    const video = manifest.find((item) => item.id === entry.id)!;
    if (normalizedStatus(entry.status) !== normalizedStatus(video.status) || entry.executed !== video.executed) {
      throw new Error(`Case ${entry.id} status/executed differs from video manifest`);
    }
    if (entry.executed) {
      if (!video.video || ![".mp4", ".webm"].includes(path.posix.extname(video.video).toLowerCase())) {
        throw new Error(`Executed Case ${entry.id} needs a WebM or MP4 video`);
      }
      const videoRef = path.posix.join(draft.evidenceDir, video.video);
      if (usedVideos.has(videoRef)) throw new Error("Executed Cases cannot share one video");
      usedVideos.add(videoRef);
      if (!entry.evidenceRefs.includes(videoRef)) throw new Error(`Case ${entry.id} does not reference its video`);
      references.add(videoRef);
      const bundled = `case-${entry.id}${path.posix.extname(video.video)}`;
      bundledVideos.push(bundled);
      references.add(path.posix.join(draft.bundleDir, "videos", bundled));
      for (const shot of bundledScreenshots(video)) {
        const shotRef = path.posix.join(draft.evidenceDir, shot.original);
        // A manifest screenshot is this Case's evidence by definition: no need to repeat it in evidenceRefs.
        if (!entry.evidenceRefs.includes(shotRef)) entry.evidenceRefs.push(shotRef);
        references.add(shotRef);
        bundledShots.push(shot.name);
        references.add(path.posix.join(draft.bundleDir, "screenshots", shot.name));
      }
    } else if (video.video) throw new Error(`Unexecuted Case ${entry.id} claims a video`);
    else if (video.screenshots?.length) throw new Error(`Unexecuted Case ${entry.id} claims screenshots`);
    for (const ref of entry.evidenceRefs) references.add(ref);
    for (const expected of entry.expected) {
      references.add(expected.sourceRef);
      for (const ref of expected.evidenceRefs) references.add(ref);
      if (expected.sourceKind === "pr_spec") {
        await verifyPrSpecSnapshot(qaRoot, expected.sourceRef, expected.anchor, draft.scope.deploymentSha);
      }
      if (decisiveStatuses.includes(entry.status) && !expected.evidenceRefs.length) {
        throw new Error(`Case ${entry.id} Expected ${expected.anchor} lacks observed evidence`);
      }
    }
  }
  const report = await readFile(await checkedPath(qaRoot, draft.refs.report), "utf8");
  noSecrets(report);
  const reportIds = [...report.matchAll(/^###\s+Case\s+([1-9]\d*)\b/gim)].map((match) => Number(match[1]));
  if (reportIds.length !== draft.cases.length || new Set(reportIds).size !== reportIds.length || draft.cases.some((entry) => !reportIds.includes(entry.id))) {
    throw new Error("Report Case headings and checker Case IDs differ");
  }
  const sections = [...report.matchAll(/^###\s+Case\s+([1-9]\d*)\b[^\n]*$/gim)];
  for (const [index, section] of sections.entries()) {
    const start = section.index! + section[0].length;
    const nextCase = sections[index + 1]?.index ?? report.length;
    const nextTopLevel = report.slice(start, nextCase).search(/^#{1,2}\s+/m);
    const end = nextTopLevel < 0 ? nextCase : Math.min(nextCase, start + nextTopLevel);
    const claimed = report.slice(start, end).match(/^\s*-\s*\*\*结论\*\*[：:]\s*(.+?)\s*$/m)?.[1]?.replace(/\*\*/g, "").trim();
    const expectedStatus = draft.cases.find((entry) => entry.id === Number(section[1]))!.status;
    if (!claimed || normalizedStatus(claimed as CaseStatus) !== normalizedStatus(expectedStatus)) {
      throw new Error(`Report Case ${section[1]} verdict differs from checker packet`);
    }
  }
  const summaryStart = report.search(/^##\s+整体结论[^\n]*$/m);
  const summary = summaryStart < 0 ? "" : report.slice(summaryStart).split(/\n##\s+/)[0];
  const statedOutcome = summary.match(/\*\*(不通过|通过)\*\*/)?.[1];
  if (statedOutcome !== draft.reportOutcome) throw new Error("Report overall outcome differs from checker packet");
  if (draft.refs.actionLog) {
    const log = await readFile(await checkedPath(qaRoot, draft.refs.actionLog), "utf8");
    const parsed = parseActionLog(log);
    if (parsed.preflight.runId !== draft.runId) throw new Error("Action log belongs to another run");
    if (!parsed.events.length) throw new Error("Action log has no executed intents; metrics are unmeasured");
    assertNoPendingCrossChecks(parsed.pendingCrossChecks);
    const usedInvocations = new Set<string>();
    for (const event of parsed.events) {
      // setup / cleanup calls (sign-in, preparation, closeout) belong to no Case but are still frozen.
      if (!isNonCasePhase(event.caseId) &&
          !draft.cases.some((entry) => event.caseId === `case-${entry.id}` || event.caseId === entry.caseKey)) {
        throw new Error(`Action reuse event belongs to an unknown Case: ${event.caseId}. ` +
          "Case events use case-<N> or the Case key; non-Case calls use setup or cleanup (e2b:action --phase setup|cleanup)");
      }
      if (event.outcome !== "hit") continue;
      for (const ref of await actionHitReferences(qaRoot, draft.runRoot, draft.refs.actionLog, event, usedInvocations)) {
        references.add(ref);
      }
    }
  }
  let laneCopies: LaneCopy[] = [];
  if (draft.lanes) {
    const verified = await verifyLanes(qaRoot, draft, manifest);
    for (const ref of verified.references) references.add(ref);
    laneCopies = verified.copies;
  } else {
    for (const ref of await verifyCaseReviewLinks(qaRoot, draft, manifest)) references.add(ref);
  }
  const rootFiles = (await readdir(await checkedPath(qaRoot, draft.bundleDir, "directory"))).sort();
  if (rootFiles.join(",") !== expectedBundleRoot(manifest)) throw new Error(bundleRootMessage);
  const videoDir = path.posix.join(draft.bundleDir, "videos");
  const actualVideos = (await readdir(await checkedPath(qaRoot, videoDir, "directory"))).sort();
  if (actualVideos.join(",") !== bundledVideos.sort().join(",")) {
    throw new Error("Artifact bundle video list differs from reviewed Cases");
  }
  if (bundledShots.length) {
    const shotDir = path.posix.join(draft.bundleDir, "screenshots");
    const actualShots = (await readdir(await checkedPath(qaRoot, shotDir, "directory"))).sort();
    if (actualShots.join(",") !== bundledShots.sort().join(",")) {
      throw new Error("Artifact bundle screenshot list differs from reviewed Cases");
    }
  }
  references.add(path.posix.join(draft.bundleDir, "qa-report.md"));
  const indexRef = path.posix.join(draft.bundleDir, "index.html");
  noSecrets(await readFile(await checkedPath(qaRoot, indexRef), "utf8"));
  references.add(indexRef);
  return { references: [...references].sort(), laneCopies };
}

/** The merged copy of a lane file must equal the lane original, which its Case packet (or closeout) froze. */
async function verifyLaneCopies(qaRoot: string, copies: readonly LaneCopy[], files: CheckerPacket["files"]): Promise<void> {
  for (const copy of copies) {
    const recorded = files[copy.ref];
    if (!recorded) throw new Error(`Merged evidence is missing from the packet: ${copy.ref}`);
    if ((await hashFile(qaRoot, copy.laneRef)).sha256 !== recorded.sha256) {
      throw new Error(`Merged copy ${copy.ref} differs from lane evidence ${copy.laneRef}`);
    }
  }
}

function verifyBundleHashes(draft: CheckerDraft, files: CheckerPacket["files"], manifest: ManifestCase[]): void {
  const markdown = path.posix.join(draft.bundleDir, "qa-report.md");
  if (files[markdown].sha256 !== files[draft.refs.report].sha256) {
    throw new Error("Bundled Markdown differs from reviewed report");
  }
  for (const item of manifest) {
    if (!item.executed) continue;
    const original = path.posix.join(draft.evidenceDir, item.video!);
    const copy = path.posix.join(draft.bundleDir, "videos", `case-${item.id}${path.posix.extname(item.video!)}`);
    if (files[original].sha256 !== files[copy].sha256) {
      throw new Error(`Bundled Case ${item.id} video differs from reviewed evidence`);
    }
    for (const [index, shot] of bundledScreenshots(item).entries()) {
      const shotOriginal = path.posix.join(draft.evidenceDir, shot.original);
      const shotCopy = path.posix.join(draft.bundleDir, "screenshots", shot.name);
      if (files[shotOriginal]?.sha256 === undefined || files[shotOriginal].sha256 !== files[shotCopy]?.sha256) {
        throw new Error(`Bundled Case ${item.id} screenshot ${index + 1} differs from reviewed evidence`);
      }
    }
  }
}

function packetBody(packet: CheckerPacket): Omit<CheckerPacket, "digest"> {
  const { digest: _digest, ...body } = packet;
  return body;
}

export async function freezeCheckerPacket(qaRoot: string, input: unknown): Promise<CheckerPacket> {
  const draft = normalizeDraft(input);
  // Drift seen in this run must be repaired and verified, or registered with a concrete blocker, before the summary freezes.
  await assertDriftRepairRecorded(
    path.join(await rootPath(qaRoot), draft.runRoot),
    draft.refs.actionLog ? path.join(await rootPath(qaRoot), draft.refs.actionLog) : undefined,
  );
  for (const lane of draft.lanes ?? []) {
    // Each lane's drift must be settled in that lane's own run-state before the merged summary freezes.
    const closeout = parseLaneCloseout(await readJson(qaRoot, lane.closeout), lane);
    await assertDriftRepairRecorded(
      path.join(await rootPath(qaRoot), lane.runRoot),
      closeout.refs.actionLog ? path.join(await rootPath(qaRoot), closeout.refs.actionLog) : undefined,
    );
  }
  const { references, laneCopies } = await collectReferences(qaRoot, draft);
  const files: CheckerPacket["files"] = {};
  for (const ref of references) files[ref] = await hashFile(qaRoot, ref);
  const manifest = parseManifest(JSON.parse(await readFile(await checkedPath(qaRoot, draft.refs.videoManifest), "utf8")));
  verifyBundleHashes(draft, files, manifest);
  await verifyLaneCopies(qaRoot, laneCopies, files);
  const body = { ...draft, files };
  return { ...body, digest: sha256(canonical(body)) };
}

export async function verifyCheckerPacket(qaRoot: string, input: unknown): Promise<CheckerPacket> {
  const packet = object(input, "packet") as unknown as CheckerPacket;
  const digest = nonempty(packet.digest, "packet digest");
  if (!/^[a-f0-9]{64}$/.test(digest) || sha256(canonical(packetBody(packet))) !== digest) {
    throw new Error("Checker packet digest mismatch");
  }
  const draft = normalizeDraft(packet);
  const { references: refs, laneCopies } = await collectReferences(qaRoot, draft);
  const files = object(packet.files, "packet files");
  if (refs.length !== Object.keys(files).length || refs.some((ref) => !Object.hasOwn(files, ref))) {
    throw new Error("Checker packet reference list changed");
  }
  for (const ref of refs) {
    const recorded = object(files[ref], `hash ${ref}`);
    const current = await hashFile(qaRoot, ref);
    if (recorded.sha256 !== current.sha256 || recorded.size !== current.size) {
      throw new Error(`Frozen evidence changed: ${ref}`);
    }
  }
  const manifest = parseManifest(JSON.parse(await readFile(await checkedPath(qaRoot, draft.refs.videoManifest), "utf8")));
  verifyBundleHashes(draft, files as CheckerPacket["files"], manifest);
  await verifyLaneCopies(qaRoot, laneCopies, files as CheckerPacket["files"]);
  return packet;
}

export async function checkReviewerDecision(
  qaRoot: string, packetInput: unknown, reviewInput: unknown, bundleDir?: string,
): Promise<CheckerGate> {
  const packet = await verifyCheckerPacket(qaRoot, packetInput);
  const review = object(reviewInput, "review") as unknown as CheckerReview;
  noSecrets(review);
  if (review.schemaVersion !== 1 || review.runId !== packet.runId || review.packetDigest !== packet.digest) {
    throw new Error("Reviewer decision does not match frozen packet");
  }
  const reviewerId = nonempty(review.reviewerId, "reviewerId");
  if (reviewerId === packet.executorId) throw new Error("Independent reviewer must differ from executor");
  if (packet.lanes?.some((lane) => lane.executorId === reviewerId)) {
    throw new Error("Independent reviewer must differ from every lane executor");
  }
  if (!Array.isArray(review.caseReviews) || review.caseReviews.length !== packet.cases.length) {
    throw new Error("Reviewer must assess every Case exactly once");
  }
  if (!Array.isArray(review.reasons) || review.reasons.some((reason) => typeof reason !== "string")) {
    throw new Error("Reviewer reasons must be strings");
  }
  const ids = new Set<number>();
  for (const item of review.caseReviews) {
    const entry = object(item, "Case review");
    if (!Number.isSafeInteger(entry.id) || !packet.cases.some((source) => source.id === entry.id) || ids.has(entry.id as number)) {
      throw new Error("Reviewer Case IDs differ from frozen Case IDs");
    }
    ids.add(entry.id as number);
    const disposition = oneOf(entry.disposition, ["upheld", "downgrade", "insufficient"] as const, "review disposition");
    nonempty(entry.reason, "review reasoning");
    if (disposition === "downgrade" && !entry.suggestedStatus) throw new Error("Downgrade needs a suggestedStatus");
    if (entry.suggestedStatus !== undefined) oneOf(entry.suggestedStatus, caseStatuses, "suggestedStatus");
  }
  const qaApprovalEligible = boolean(review.qaApprovalEligible, "qaApprovalEligible");
  const artifactPublishable = boolean(review.artifactPublishable, "artifactPublishable");
  const allUpheld = review.caseReviews.every((item) => item.disposition === "upheld");
  if (artifactPublishable && !allUpheld) throw new Error("A challenged Case must be corrected and reviewed before publishing");
  const readyForApproval = allUpheld && packet.cases.some((entry) => entry.applicable) &&
    packet.cases.every((entry) => entry.expected.length > 0) &&
    packet.cases.every((entry) => !entry.applicable || entry.status === "Pass") &&
    packet.reportOutcome === "通过" && packet.cleanup.state === "verified" &&
    !packet.cleanup.actionUnknown && packet.scope.deploymentSha !== "unknown";
  if (qaApprovalEligible && (!artifactPublishable || !readyForApproval)) {
    throw new Error("QA approval claim conflicts with Case evidence, cleanup, or publication gate");
  }
  if (artifactPublishable && packet.reportOutcome === "通过" && !qaApprovalEligible) {
    throw new Error("A report claiming Pass needs independent QA approval before publication");
  }
  if (bundleDir && artifactPublishable) await verifyBundle(qaRoot, packet, bundleDir);
  return {
    runId: packet.runId, packetDigest: packet.digest,
    qaApprovalEligible, artifactPublishable, reasons: review.reasons,
  };
}

async function verifyBundle(qaRoot: string, packet: CheckerPacket, bundleDir: string): Promise<void> {
  if (relative(bundleDir, "bundleDir") !== packet.bundleDir) throw new Error("Publish directory differs from reviewer-frozen bundle");
  await checkedPath(qaRoot, bundleDir, "directory");
  const manifest = parseManifest(JSON.parse(await readFile(await checkedPath(qaRoot, packet.refs.videoManifest), "utf8")));
  const rootFiles = (await readdir(await checkedPath(qaRoot, bundleDir, "directory"))).sort();
  if (rootFiles.join(",") !== expectedBundleRoot(manifest)) throw new Error(bundleRootMessage);
  await checkedPath(qaRoot, path.posix.join(bundleDir, "videos"), "directory");
  const markdown = path.posix.join(bundleDir, "qa-report.md");
  if ((await hashFile(qaRoot, markdown)).sha256 !== packet.files[packet.refs.report].sha256) {
    throw new Error("Published Markdown differs from reviewed report");
  }
  const expectedVideos: string[] = [];
  const expectedShots: string[] = [];
  const index = await readFile(await checkedPath(qaRoot, path.posix.join(bundleDir, "index.html")), "utf8");
  noSecrets(index);
  if ((await hashFile(qaRoot, path.posix.join(bundleDir, "index.html"))).sha256 !==
    packet.files[path.posix.join(packet.bundleDir, "index.html")].sha256) {
    throw new Error("Artifact homepage changed since reviewer freeze");
  }
  if (!index.includes(`<strong>${packet.reportOutcome}</strong>`)) {
    throw new Error("Artifact homepage overall outcome differs from reviewed report");
  }
  const labels: Record<CaseStatus, string> = {
    Pass: "通过", ProductFail: "产品问题", "Product bug": "产品问题",
    Blocked: "阻塞", Inconclusive: "无法判断", "Automation failure": "自动化问题",
    Environment: "环境问题", "Documentation drift": "文档过时", "UX observation": "体验观察",
    "Requirement conflict": "规则冲突", NotRun: "未执行", NotApplicable: "不适用", SkippedByConstraint: "按约束跳过",
  };
  for (const item of manifest) {
    if (!index.includes(`id="case-${item.id}"`) ||
      !new RegExp(`<a href="#case-${item.id}">(?:(?!<\\/a>)[\\s\\S])*?<b>${labels[item.status]}<\\/b><\\/a>`).test(index)) {
      throw new Error(`Artifact homepage does not reflect Case ${item.id} status`);
    }
    if (!item.executed) continue;
    const origin = path.posix.join(packet.evidenceDir, item.video!);
    const name = `case-${item.id}${path.posix.extname(item.video!)}`;
    expectedVideos.push(name);
    if (!index.includes(`src="./videos/${name}"`)) throw new Error(`Artifact homepage lacks Case ${item.id} video`);
    const bundled = path.posix.join(bundleDir, "videos", name);
    if ((await hashFile(qaRoot, bundled)).sha256 !== packet.files[origin].sha256) {
      throw new Error(`Bundled Case ${item.id} video differs from reviewed evidence`);
    }
    for (const [shotIndex, shot] of bundledScreenshots(item).entries()) {
      expectedShots.push(shot.name);
      if (!index.includes(`src="./screenshots/${shot.name}"`)) throw new Error(`Artifact homepage lacks Case ${item.id} screenshot ${shotIndex + 1}`);
      const shotOrigin = packet.files[path.posix.join(packet.evidenceDir, shot.original)];
      if (!shotOrigin || (await hashFile(qaRoot, path.posix.join(bundleDir, "screenshots", shot.name))).sha256 !== shotOrigin.sha256) {
        throw new Error(`Bundled Case ${item.id} screenshot ${shotIndex + 1} differs from reviewed evidence`);
      }
    }
  }
  const actualVideos = (await readdir(await checkedPath(qaRoot, path.posix.join(bundleDir, "videos"), "directory"))).sort();
  if (actualVideos.join(",") !== expectedVideos.sort().join(",")) throw new Error("Artifact bundle video list differs from reviewed Cases");
  if (expectedShots.length) {
    const actualShots = (await readdir(await checkedPath(qaRoot, path.posix.join(bundleDir, "screenshots"), "directory"))).sort();
    if (actualShots.join(",") !== expectedShots.sort().join(",")) throw new Error("Artifact bundle screenshot list differs from reviewed Cases");
  }
}

// ---------------------------------------------------------------------------
// Incremental (per-Case) independent review
// ---------------------------------------------------------------------------

const caseSideEffectStates: readonly CaseSideEffectState[] = ["none", "cleaned", "pending_cleanup", "residual", "unknown"];
const caseReviewFilePattern = /^case-([1-9]\d*)(?:\.r([1-9]\d*))?\.(packet|review)\.json$/;

/** `RUN_ROOT/run-state/checker`, where Case packets/reviews and the summary inputs live (never published). */
export function caseCheckerDir(runRoot: string): string {
  return path.posix.join(runRoot, "run-state", "checker");
}

function caseStem(runRoot: string, caseId: number, revision: number): string {
  return path.posix.join(caseCheckerDir(runRoot), `case-${caseId}${revision > 1 ? `.r${revision}` : ""}`);
}

function normalizeCaseData(value: unknown, caseId: number): CaseData {
  const data = object(value, "data");
  if (!Array.isArray(data.mutates)) throw new Error("data mutates must be an array");
  return {
    requires: stringList(data.requires, "data requires"),
    produces: stringList(data.produces, "data produces"),
    mutates: data.mutates.map((item, index) => {
      const mutation = object(item, `data mutates[${index}]`);
      const state = nonempty(mutation.state, `data mutates[${index}] state`);
      const reversible = boolean(mutation.reversible, `data mutates[${index}] reversible`);
      const undo = mutation.undo === undefined ? undefined : nonempty(mutation.undo, `data mutates[${index}] undo`);
      if (!reversible && undo) {
        throw new Error(`Case ${caseId} irreversible state "${state}" cannot declare an undo; use a disposable account/org instead`);
      }
      if (reversible && !undo) {
        throw new Error(`Case ${caseId} reversible state "${state}" needs an undo (Action undoneBy or page operation)`);
      }
      return { state, reversible, ...(undo ? { undo } : {}) };
    }),
  };
}

function normalizeCaseRerun(value: unknown): CaseRerun {
  const rerun = object(value, "rerun");
  return {
    reason: nonempty(rerun.reason, "rerun reason"),
    preconditionCheck: nonempty(rerun.preconditionCheck, "rerun preconditionCheck"),
    preconditionEvidence: (() => {
      const refs = stringList(rerun.preconditionEvidence ?? [], "rerun preconditionEvidence")
        .map((ref) => relative(ref, "rerun preconditionEvidence"));
      if (refs.length === 0) throw new Error("rerun preconditionEvidence must list at least one frozen screenshot or fact");
      return refs;
    })(),
    fromPacket: relative(rerun.fromPacket, "rerun fromPacket"),
  };
}

/** Revision of the replaced packet; it must be a `case-N[.rK].packet.json` of the same Case in this run. */
function rerunPacketRevision(fromPacket: string, runRoot: string, caseId: number): number {
  const fail = (): never => {
    throw new Error(`rerun fromPacket must be an earlier packet of Case ${caseId} in ${caseCheckerDir(runRoot)}: ${fromPacket}`);
  };
  if (path.posix.dirname(fromPacket) !== caseCheckerDir(runRoot)) fail();
  const match = caseReviewFilePattern.exec(path.posix.basename(fromPacket));
  if (!match || match[3] !== "packet" || match[2] === "1" || Number(match[1]) !== caseId) fail();
  return match![2] ? Number(match![2]) : 1;
}

function normalizeCaseDraft(input: unknown): CaseCheckerDraft {
  noSecrets(input);
  const draft = object(input, "Case packet");
  if (draft.schemaVersion !== 1 || draft.kind !== "case") throw new Error("Unsupported Case packet version or kind");
  const entry = normalizeCase(draft.case, 0);
  if (!entry.executed) {
    throw new Error(`Only an executed Case can be frozen for Case review; Case ${entry.id} is ${entry.status} and is checked in the summary review`);
  }
  const refs = object(draft.refs, "Case refs");
  const side = object(draft.sideEffects, "sideEffects");
  const sideState = oneOf(side.state, caseSideEffectStates, "sideEffects state");
  const actionUnknown = boolean(side.actionUnknown, "sideEffects actionUnknown");
  const sideReason = side.reason === undefined ? undefined : nonempty(side.reason, "sideEffects reason");
  if ((!["none", "cleaned"].includes(sideState) || actionUnknown) && !sideReason) {
    throw new Error(`Case ${entry.id} unresolved side effects need a reason`);
  }
  const normalized: CaseCheckerDraft = {
    schemaVersion: 1, kind: "case",
    runId: nonempty(draft.runId, "runId"),
    executorId: nonempty(draft.executorId, "executorId"),
    runRoot: relative(draft.runRoot, "runRoot"),
    scope: scopeOf(draft.scope),
    case: entry,
    refs: {
      caseHarvest: relative(refs.caseHarvest, "caseHarvest"),
      video: relative(refs.video, "Case video"),
      screenshots: stringList(refs.screenshots ?? [], "Case screenshots").map((ref) => relative(ref, "Case screenshot")),
      facts: stringList(refs.facts ?? [], "Case facts").map((ref) => relative(ref, "Case fact")),
      ...(refs.actionLog === undefined ? {} : { actionLog: relative(refs.actionLog, "actionLog") }),
    },
    sideEffects: { state: sideState, actionUnknown, ...(sideReason ? { reason: sideReason } : {}) },
    ...(draft.data === undefined ? {} : { data: normalizeCaseData(draft.data, entry.id) }),
    ...(draft.rerun === undefined ? {} : { rerun: normalizeCaseRerun(draft.rerun) }),
  };
  checkRunIdentity(normalized.runId, normalized.scope.feature, normalized.runRoot);
  checkCasePaths(entry, normalized.runRoot);
  if (normalized.rerun) {
    rerunPacketRevision(normalized.rerun.fromPacket, normalized.runRoot, entry.id);
    const frozen = new Set([...normalized.refs.screenshots, ...normalized.refs.facts]);
    for (const ref of normalized.rerun.preconditionEvidence) {
      if (!frozen.has(ref)) throw new Error(`rerun preconditionEvidence ${ref} is not among Case ${entry.id}'s frozen screenshots or facts`);
    }
  }
  const { runRoot } = normalized;
  runChild(normalized.refs.caseHarvest, runRoot, "caseHarvest");
  if (normalized.refs.actionLog) runChild(normalized.refs.actionLog, runRoot, "actionLog");
  runChild(normalized.refs.video, runRoot, "Case video");
  if (![".mp4", ".webm"].includes(path.posix.extname(normalized.refs.video).toLowerCase())) {
    throw new Error(`Executed Case ${entry.id} needs a WebM or MP4 video`);
  }
  if (!entry.evidenceRefs.includes(normalized.refs.video)) throw new Error(`Case ${entry.id} does not reference its video`);
  if (new Set(normalized.refs.screenshots).size !== normalized.refs.screenshots.length) throw new Error(`Case ${entry.id} lists a duplicate screenshot`);
  for (const shot of normalized.refs.screenshots) {
    runChild(shot, runRoot, "Case screenshot");
    if (!screenshotExtensions.includes(path.posix.extname(shot).toLowerCase())) {
      throw new Error(`Case ${entry.id} screenshot must be PNG, JPEG or WebP`);
    }
    // refs.screenshots are this Case's evidence by definition: add them instead of requiring a repeat.
    if (!entry.evidenceRefs.includes(shot)) entry.evidenceRefs.push(shot);
  }
  const cited = new Set([...entry.evidenceRefs, ...entry.expected.flatMap((expected) => expected.evidenceRefs)]);
  for (const fact of normalized.refs.facts) {
    runChild(fact, runRoot, "Case fact");
    if (!cited.has(fact)) throw new Error(`Case ${entry.id} does not cite its fact ${fact}`);
  }
  noSecrets(normalized);
  return normalized;
}

async function collectCaseReferences(
  qaRoot: string, draft: CaseCheckerDraft,
): Promise<{ refs: string[]; actionEntries?: CaseCheckerPacket["actionEntries"] }> {
  const entry = draft.case;
  const harvest = await readFile(await checkedPath(qaRoot, draft.refs.caseHarvest), "utf8");
  if (!new RegExp(`\\bCase\\s+${entry.id}(?!\\d)`).test(harvest) && !harvest.includes(entry.caseKey)) {
    throw new Error(`case-harvest has no entry for Case ${entry.id}; settle the Case before freezing it`);
  }
  const references = new Set<string>([draft.refs.video, ...draft.refs.screenshots, ...draft.refs.facts, ...entry.evidenceRefs]);
  for (const expected of entry.expected) {
    references.add(expected.sourceRef);
    for (const ref of expected.evidenceRefs) references.add(ref);
    if (expected.sourceKind === "pr_spec") {
      await verifyPrSpecSnapshot(qaRoot, expected.sourceRef, expected.anchor, draft.scope.deploymentSha);
    }
    if (decisiveStatuses.includes(entry.status) && !expected.evidenceRefs.length) {
      throw new Error(`Case ${entry.id} Expected ${expected.anchor} lacks observed evidence`);
    }
  }
  if (draft.rerun) {
    // The replaced packet is frozen with the rerun: it must be a real earlier packet of this Case in this run.
    let replaced: Record<string, unknown> | undefined;
    try { replaced = object(await readJson(qaRoot, draft.rerun.fromPacket), "replaced packet"); }
    catch { replaced = undefined; }
    const replacedCase = replaced?.case as Record<string, unknown> | undefined;
    if (!replaced || replaced.kind !== "case" || replaced.runId !== draft.runId || replacedCase?.id !== entry.id) {
      throw new Error(`rerun fromPacket must be an earlier packet of Case ${entry.id} in this run: ${draft.rerun.fromPacket}`);
    }
    references.add(draft.rerun.fromPacket);
  }
  let actionEntries: CaseCheckerPacket["actionEntries"];
  if (draft.refs.actionLog) {
    const log = await readFile(await checkedPath(qaRoot, draft.refs.actionLog), "utf8");
    const parsed = parseActionLog(log);
    if (parsed.preflight.runId !== draft.runId) throw new Error("Action log belongs to another run");
    // Only this Case's entries are frozen: later Cases keep appending to the shared log.
    const events = parsed.events.filter((event) => event.caseId === `case-${entry.id}` || event.caseId === entry.caseKey);
    assertNoPendingCrossChecks(events.filter((event) => event.outcome === "pending_crosscheck"));
    const usedInvocations = new Set<string>();
    for (const event of events) {
      if (event.outcome !== "hit") continue;
      for (const ref of await actionHitReferences(qaRoot, draft.runRoot, draft.refs.actionLog, event, usedInvocations)) {
        references.add(ref);
      }
    }
    actionEntries = { count: events.length, sha256: sha256(canonical(events)) };
  }
  return { refs: [...references].sort(), ...(actionEntries ? { actionEntries } : {}) };
}

/** Freeze one settled, executed Case for an independent Case reviewer. */
export async function freezeCasePacket(qaRoot: string, input: unknown): Promise<CaseCheckerPacket> {
  const draft = normalizeCaseDraft(input);
  if (draft.rerun) {
    // The new packet always takes the next revision, so the replaced one must already exist below it.
    const latest = latestPacketRevision(await listCaseReviewFiles(qaRoot, draft.runRoot), draft.case.id) ?? 0;
    if (rerunPacketRevision(draft.rerun.fromPacket, draft.runRoot, draft.case.id) > latest) {
      throw new Error(`rerun fromPacket must be an earlier packet of Case ${draft.case.id}; latest frozen revision is ${latest}`);
    }
  }
  const { refs, actionEntries } = await collectCaseReferences(qaRoot, draft);
  const files: CaseCheckerPacket["files"] = {};
  for (const ref of refs) files[ref] = await hashFile(qaRoot, ref);
  const body = { ...draft, files, ...(actionEntries ? { actionEntries } : {}) };
  return { ...body, digest: sha256(canonical(body)) };
}

/** Re-check a Case packet's digest and that none of its evidence changed since it was frozen. */
export async function verifyCasePacket(qaRoot: string, input: unknown): Promise<CaseCheckerPacket> {
  const packet = object(input, "Case packet") as unknown as CaseCheckerPacket;
  const digest = nonempty(packet.digest, "Case packet digest");
  const { digest: _digest, ...body } = packet;
  if (!/^[a-f0-9]{64}$/.test(digest) || sha256(canonical(body)) !== digest) {
    throw new Error("Case packet digest mismatch");
  }
  const draft = normalizeCaseDraft(packet);
  const { refs, actionEntries } = await collectCaseReferences(qaRoot, draft);
  if (canonical(actionEntries ?? null) !== canonical(packet.actionEntries ?? null)) {
    throw new Error(`Action log entries changed for Case ${draft.case.id}`);
  }
  const files = object(packet.files, "Case packet files");
  if (refs.length !== Object.keys(files).length || refs.some((ref) => !Object.hasOwn(files, ref))) {
    throw new Error("Case packet reference list changed");
  }
  for (const ref of refs) {
    const recorded = object(files[ref], `hash ${ref}`);
    const current = await hashFile(qaRoot, ref);
    if (recorded.sha256 !== current.sha256 || recorded.size !== current.size) {
      throw new Error(`Frozen evidence changed: ${ref}`);
    }
  }
  return packet;
}

/** Validate an independent Case review against a still-valid Case packet. */
export async function checkCaseReview(qaRoot: string, packetInput: unknown, reviewInput: unknown): Promise<CaseReviewResult> {
  const packet = await verifyCasePacket(qaRoot, packetInput);
  const review = object(reviewInput, "Case review");
  noSecrets(review);
  if (review.schemaVersion !== 1 || review.kind !== "case" || review.runId !== packet.runId ||
      review.packetDigest !== packet.digest || review.caseId !== packet.case.id) {
    throw new Error("Case review does not match frozen Case packet");
  }
  const reviewerId = nonempty(review.reviewerId, "reviewerId");
  if (reviewerId === packet.executorId) throw new Error("Independent reviewer must differ from executor");
  const disposition = oneOf(review.disposition, ["upheld", "downgrade", "insufficient"] as const, "Case review disposition");
  nonempty(review.reason, "Case review reasoning");
  if (disposition === "downgrade" && !review.suggestedStatus) throw new Error("Downgrade needs a suggestedStatus");
  if (review.suggestedStatus !== undefined) oneOf(review.suggestedStatus, caseStatuses, "suggestedStatus");
  const feedback = review.feedback === undefined ? [] : stringList(review.feedback, "Case review feedback");
  return {
    runId: packet.runId, caseId: packet.case.id, packetDigest: packet.digest, reviewerId,
    disposition, upheld: disposition === "upheld", feedback,
  };
}

type CaseReviewFiles = Map<number, Map<number, { packet?: string; review?: string }>>;

async function listCaseReviewFiles(qaRoot: string, runRoot: string): Promise<CaseReviewFiles> {
  const dir = caseCheckerDir(runRoot);
  let names: string[];
  try { names = await readdir(await checkedPath(qaRoot, dir, "directory")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const files: CaseReviewFiles = new Map();
  for (const name of names.sort()) {
    if (!/^case-.*\.(packet|review)\.json$/.test(name)) continue;
    const match = caseReviewFilePattern.exec(name);
    if (!match || match[2] === "1") throw new Error(`Unexpected Case review file name: ${dir}/${name}`);
    const caseId = Number(match[1]);
    const revision = match[2] ? Number(match[2]) : 1;
    const revisions = files.get(caseId) ?? new Map();
    files.set(caseId, revisions);
    const slot = revisions.get(revision) ?? {};
    slot[match[3] as "packet" | "review"] = `${dir}/${name}`;
    revisions.set(revision, slot);
  }
  return files;
}

function latestPacketRevision(files: CaseReviewFiles, caseId: number): number | undefined {
  const revisions = [...(files.get(caseId)?.entries() ?? [])].filter(([, slot]) => slot.packet).map(([revision]) => revision);
  return revisions.length ? Math.max(...revisions) : undefined;
}

/** The only output name `freeze-case` accepts next for this Case: never overwrite an earlier signature. */
export async function nextCasePacketRef(qaRoot: string, runRoot: string, caseId: number): Promise<string> {
  const latest = latestPacketRevision(await listCaseReviewFiles(qaRoot, runRoot), caseId);
  return `${caseStem(runRoot, caseId, (latest ?? 0) + 1)}.packet.json`;
}

export async function readJson(qaRoot: string, ref: string): Promise<unknown> {
  return JSON.parse(await readFile(await checkedPath(qaRoot, ref), "utf8"));
}

/**
 * The latest Case packet/review a link must point at, and the checks every link shares: it names the latest
 * revision, the review exists, still matches its packet and is upheld. Returns the validated packet.
 */
async function checkLinkedCase(
  qaRoot: string, files: CaseReviewFiles, runRoot: string, link: CaseReviewLink,
): Promise<CaseCheckerPacket> {
  const latest = latestPacketRevision(files, link.caseId);
  if (latest === undefined) throw new Error(`Case ${link.caseId} has no Case review; freeze and review it first`);
  const stem = caseStem(runRoot, link.caseId, latest);
  if (link.packet !== `${stem}.packet.json`) throw new Error(`Case ${link.caseId} must link the latest Case ${link.caseId} packet ${stem}.packet.json`);
  if (link.review !== `${stem}.review.json` || !files.get(link.caseId)!.get(latest)!.review) {
    throw new Error(`Case ${link.caseId} has no Case review for ${stem}.packet.json; expected ${stem}.review.json`);
  }
  const packet = await readJson(qaRoot, link.packet) as CaseCheckerPacket;
  const result = await checkCaseReview(qaRoot, packet, await readJson(qaRoot, link.review));
  if (!result.upheld) {
    throw new Error(`Case ${link.caseId} review is not upheld (${result.disposition}); correct, re-freeze and re-review that Case`);
  }
  return packet;
}

/**
 * Summary-level checks for incremental review. Returns the Case packet/review refs that the summary packet freezes.
 * A run that started per-Case review cannot fall back to whole-run review.
 */
async function verifyCaseReviewLinks(qaRoot: string, draft: CheckerDraft, manifest: ManifestCase[]): Promise<string[]> {
  const files = await listCaseReviewFiles(qaRoot, draft.runRoot);
  const links = draft.caseReviews ?? [];
  if (!links.length) {
    if (files.size) {
      throw new Error(`Incremental Case review already started (Case ${[...files.keys()].join(", ")}); link every executed Case's latest Case review in caseReviews instead of falling back to whole-run review`);
    }
    return [];
  }
  const executed = new Map(draft.cases.filter((entry) => entry.executed).map((entry) => [entry.id, entry]));
  const linked = new Set<number>();
  const references: string[] = [];
  for (const link of links) {
    const entry = executed.get(link.caseId);
    if (!entry) throw new Error(`Case review ${link.caseId} is not an executed Case in the summary`);
    if (linked.has(link.caseId)) throw new Error(`Case ${link.caseId} has more than one Case review link`);
    linked.add(link.caseId);
    const packet = await checkLinkedCase(qaRoot, files, draft.runRoot, link);
    if (packet.runId !== draft.runId || packet.executorId !== draft.executorId || packet.runRoot !== draft.runRoot ||
        canonical(packet.scope) !== canonical(draft.scope)) {
      throw new Error(`Case ${link.caseId} packet belongs to another run, executor or scope`);
    }
    if (canonical(packet.case) !== canonical(entry)) {
      throw new Error(`Case ${link.caseId} differs from its reviewed Case packet; re-freeze and re-review it instead of changing it in the summary`);
    }
    const video = manifest.find((item) => item.id === link.caseId)!;
    const shots = (video.screenshots ?? []).map((shot) => path.posix.join(draft.evidenceDir, shot.path));
    if (packet.refs.video !== path.posix.join(draft.evidenceDir, video.video!) || canonical(packet.refs.screenshots) !== canonical(shots)) {
      throw new Error(`Case ${link.caseId} video or screenshots differ from its reviewed Case packet`);
    }
    if ((packet.refs.actionLog ?? null) !== (draft.refs.actionLog ?? null)) {
      throw new Error(`Case ${link.caseId} Action log differs from its reviewed Case packet`);
    }
    references.push(link.packet, link.review);
  }
  for (const id of executed.keys()) {
    if (!linked.has(id)) throw new Error(`Case ${id} has no Case review; every executed Case needs one in incremental mode`);
  }
  for (const id of files.keys()) {
    if (!linked.has(id)) throw new Error(`Case ${id} has Case review files but is not linked in caseReviews`);
  }
  return references;
}

/**
 * Summary-level checks for a merged run. Every lane's executed Cases keep the Case packet and review their own
 * lane froze (verified in place, in the lane's run root); the merged summary only has to prove that what it
 * reports is exactly what those reviews covered: same Case, same video/screenshots, byte-identical evidence
 * copies, lane closeouts that agree, and the worst lane cleanup state.
 */
async function verifyLanes(
  qaRoot: string, draft: CheckerDraft, manifest: ManifestCase[],
): Promise<{ references: string[]; copies: LaneCopy[] }> {
  if (draft.refs.actionLog !== undefined) throw new Error("A merged packet has no Action log of its own");
  if ((await listCaseReviewFiles(qaRoot, draft.runRoot)).size) {
    throw new Error("A merged run executes no Case: its own run-state/checker/ must not hold Case packets or reviews");
  }
  const lanes = draft.lanes!;
  const links = draft.caseReviews ?? [];
  const references = new Set<string>();
  const copies = new Map<string, string>();
  const closeouts: LaneCloseout[] = [];
  const linked = new Set<number>();
  for (const lane of lanes) {
    const closeout = parseLaneCloseout(await readJson(qaRoot, lane.closeout), lane);
    closeouts.push(closeout);
    references.add(lane.closeout);
    references.add(closeout.refs.cleanup);
    if (canonical(closeout.cases.map((entry) => entry.id).sort((a, b) => a - b)) !== canonical(lane.caseIds)) {
      throw new Error(`Lane ${lane.lane} closeout Cases differ from the Case IDs the merged packet assigns to it`);
    }
    if (closeout.refs.actionLog) {
      references.add(closeout.refs.actionLog);
      const parsed = parseActionLog(await readFile(await checkedPath(qaRoot, closeout.refs.actionLog), "utf8"));
      if (parsed.preflight.runId !== lane.runId) throw new Error(`Lane ${lane.lane} Action log belongs to another run`);
      assertNoPendingCrossChecks(parsed.pendingCrossChecks);
      for (const event of parsed.events) {
        if (!isNonCasePhase(event.caseId) &&
            !closeout.cases.some((entry) => event.caseId === `case-${entry.id}` || event.caseId === entry.caseKey)) {
          throw new Error(`Lane ${lane.lane} Action event belongs to an unknown Case: ${event.caseId}`);
        }
      }
    }
    const files = await listCaseReviewFiles(qaRoot, lane.runRoot);
    for (const id of files.keys()) {
      if (!lane.caseIds.includes(id)) throw new Error(`Lane ${lane.lane} has Case review files for Case ${id}, which is not one of its Cases`);
    }
    const addCopy = (laneRef: string) => {
      const ref = laneMergedRef(laneRef, lane, draft.runRoot);
      if (ref !== laneRef) copies.set(ref, laneRef);
    };
    for (const closeoutCase of closeout.cases) {
      const draftCase = draft.cases.find((entry) => entry.id === closeoutCase.id)!;
      if (!closeoutCase.executed) {
        if (files.has(closeoutCase.id)) throw new Error(`Lane ${lane.lane} Case ${closeoutCase.id} is not executed but has Case review files`);
        if (canonical(laneMergedCase(closeoutCase, lane, draft.runRoot)) !== canonical(draftCase)) {
          throw new Error(`Case ${closeoutCase.id} differs from lane ${lane.lane}'s closeout`);
        }
        for (const atom of closeoutCase.expected) {
          addCopy(atom.sourceRef);
          atom.evidenceRefs.forEach(addCopy);
        }
        closeoutCase.evidenceRefs.forEach(addCopy);
        continue;
      }
      const matching = links.filter((link) => link.caseId === closeoutCase.id);
      if (matching.length !== 1) {
        throw new Error(`Case ${closeoutCase.id} needs exactly one Case review link (lane ${lane.lane}; found ${matching.length})`);
      }
      linked.add(closeoutCase.id);
      const packet = await checkLinkedCase(qaRoot, files, lane.runRoot, matching[0]);
      if (packet.runId !== lane.runId || packet.executorId !== lane.executorId || packet.runRoot !== lane.runRoot ||
          canonical(packet.scope) !== canonical(lane.scope)) {
        throw new Error(`Case ${closeoutCase.id} packet belongs to another run, executor or scope than lane ${lane.lane}`);
      }
      if (packet.case.caseKey !== closeoutCase.caseKey || packet.case.status !== closeoutCase.status) {
        throw new Error(`Case ${closeoutCase.id} differs between lane ${lane.lane}'s closeout and its reviewed Case packet`);
      }
      if (canonical(laneMergedCase(packet.case, lane, draft.runRoot)) !== canonical(draftCase)) {
        throw new Error(`Case ${closeoutCase.id} differs from its reviewed Case packet; re-freeze and re-review it in lane ${lane.lane} instead of changing it in the summary`);
      }
      const video = manifest.find((item) => item.id === closeoutCase.id)!;
      const shots = (video.screenshots ?? []).map((shot) => path.posix.join(draft.evidenceDir, shot.path));
      if (laneMergedRef(packet.refs.video, lane, draft.runRoot) !== path.posix.join(draft.evidenceDir, video.video!) ||
          canonical(packet.refs.screenshots.map((ref) => laneMergedRef(ref, lane, draft.runRoot))) !== canonical(shots)) {
        throw new Error(`Case ${closeoutCase.id} video or screenshots differ from its reviewed Case packet`);
      }
      for (const ref of [packet.refs.video, ...packet.refs.screenshots, ...packet.refs.facts, ...packet.case.evidenceRefs,
        ...packet.case.expected.flatMap((atom) => [atom.sourceRef, ...atom.evidenceRefs])]) addCopy(ref);
      references.add(matching[0].packet);
      references.add(matching[0].review);
    }
  }
  for (const link of links) {
    if (!linked.has(link.caseId)) throw new Error(`Case review link ${link.caseId} is not an executed Case of any lane`);
  }
  const aggregate = aggregateLaneCleanup(closeouts);
  if (draft.cleanup.state !== aggregate.state || draft.cleanup.actionUnknown !== aggregate.actionUnknown) {
    throw new Error(`Merged cleanup (${draft.cleanup.state}${draft.cleanup.actionUnknown ? ", action_unknown" : ""}) differs from the lanes' aggregate (${aggregate.state}${aggregate.actionUnknown ? ", action_unknown" : ""})`);
  }
  return { references: [...references], copies: [...copies].map(([ref, laneRef]) => ({ ref, laneRef })) };
}

/** Per-Case review state for `qa:checker status`. */
export async function caseReviewStatus(qaRoot: string, runRootInput: string): Promise<CaseReviewStatus> {
  const runRoot = relative(runRootInput, "runRoot");
  await checkedPath(qaRoot, runRoot, "directory");
  let manifest: ManifestCase[] = [];
  try { manifest = parseManifest(await readJson(qaRoot, path.posix.join(runRoot, "run-state", "video-manifest.json"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const files = await listCaseReviewFiles(qaRoot, runRoot);
  const ids = [...new Set([...manifest.map((item) => item.id), ...files.keys()])].sort((left, right) => left - right);
  const cases: CaseReviewStatus["cases"] = [];
  for (const caseId of ids) {
    const latest = latestPacketRevision(files, caseId);
    if (latest === undefined) {
      const planned = manifest.find((item) => item.id === caseId);
      cases.push(planned && !planned.executed
        ? { caseId, state: "not_required", reason: `${planned.status}: checked in the summary review` }
        : { caseId, state: "not_frozen" });
      continue;
    }
    const slot = files.get(caseId)!.get(latest)!;
    const base = { caseId, revision: latest, packet: slot.packet! };
    let packet: unknown;
    try {
      packet = await readJson(qaRoot, slot.packet!);
      await verifyCasePacket(qaRoot, packet);
    } catch (error) {
      cases.push({ ...base, state: "invalidated", reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!slot.review) {
      cases.push({ ...base, state: "pending_review" });
      continue;
    }
    try {
      const review = await readJson(qaRoot, slot.review) as CaseCheckerReview;
      const result = await checkCaseReview(qaRoot, packet, review);
      cases.push({
        ...base, review: slot.review, state: result.upheld ? "upheld" : "needs_fix",
        ...(result.upheld ? {} : { reason: `${result.disposition}: ${review.reason}` }),
        ...(result.feedback.length ? { feedback: result.feedback } : {}),
      });
    } catch (error) {
      cases.push({ ...base, review: slot.review, state: "invalidated", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { runRoot, cases };
}
