import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkedPath } from "./checker";
import { checkReviewerDecision, verifyCheckerPacket, type CheckerPacket, type CheckerReview } from "./checker";
import { readHumanReviewLedger, type BlindInventoryEvent } from "./human-review";
import { validatePrDiffInventoryShape, verifyPrDiffInventory, type PrDiffInventory } from "./pr-diff";
import { inspectRun, type RunRecord } from "./state";

type Category = "happy" | "negative" | "edge";
type EvidenceHash = { sha256: string; size: number };
type Scope = RunRecord["scope"];
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const sources = ["self_critic", "execution_discovery", "checker", "human", "escaped_defect"] as const;
export type OmissionSource = typeof sources[number];
export const caseGenerators = ["G1-acceptance", "G2-assertions", "G3-transitions", "G4-execution-modes",
  "G5-state-pairs", "G6-cross-cutting", "G7-history"] as const;
export type CaseGenerator = typeof caseGenerators[number];
export type FindingGenerator = CaseGenerator | "none";
export type GeneratorGap = "material" | "rule";
const findingGenerators = [...caseGenerators, "none"] as const;

export type PlanInput = {
  schemaVersion: 1;
  runId: string;
  changeInventoryRef?: string;
  targets: { targetKey: string; description: string; sourceRef: string; anchor: string; changeIds?: string[] }[];
  mechanisms: { mechanismKey: string; category: Category; targetKeys: string[]; applicable: boolean; generator?: CaseGenerator }[];
  /** `lane` is required on every Case of a merged run (`loop:state init --lanes`) and forbidden elsewhere. */
  cases: { caseKey: string; category: Category; mechanismKeys: string[]; applicable?: boolean; lane?: string }[];
};

export type OmissionPlan = PlanInput & {
  runRoot: string;
  journeyKey: string;
  mode: RunRecord["mode"];
  scope: Scope;
  executorId: string;
  createdAt: string;
  sourceHashes: Record<string, EvidenceHash>;
  blindInventory?: {
    eventId: string;
    sha256: string;
    mechanisms: { mechanismKey: string; category: Category; applicable: boolean }[];
  };
  digest: string;
};

type Common = { schemaVersion: 1; eventId: string; runId: string; planDigest: string; createdAt: string;
  previousDigest: string | null; digest: string };
export type Finding = Common & {
  event: "finding";
  mechanismKey: string;
  category: Category;
  targetKeys: string[];
  source: OmissionSource;
  actorId: string;
  reason: string;
  expectedAuthority: "ticket" | "user" | "active_model" | "pr_spec" | "unconfirmed";
  evidenceRefs: string[];
  evidenceHashes: Record<string, EvidenceHash>;
  generator?: FindingGenerator;
  generatorGap?: GeneratorGap;
};
export type Decision = Common & {
  event: "decision";
  findingId: string;
  reviewerId: string;
  status: "confirmed" | "rejected" | "duplicate";
  reason: string;
  reviewRef: string;
  reviewHash: EvidenceHash;
  duplicateOf?: string;
  requiredForApproval?: boolean;
};
export type Closure = Common & {
  event: "closure";
  findingId: string;
  kind: "verified_case" | "retired_with_authority";
  runIdVerified?: string;
  caseKey?: string;
  packetDigest?: string;
  reviewerId?: string;
  reason?: string;
  authorityRef?: string;
  authorityHash?: EvidenceHash;
};
export type Repair = Common & {
  event: "repair";
  findingId: string;
  kind: "repaired_current_run";
  caseKey: string;
  packetDigest: string;
};
export type OmissionEvent = Finding | Decision | Repair | Closure;
type UnsealedEvent = Omit<Finding, "previousDigest" | "digest"> | Omit<Decision, "previousDigest" | "digest"> |
  Omit<Repair, "previousDigest" | "digest"> | Omit<Closure, "previousDigest" | "digest">;
export type FindingInput = Omit<Finding, keyof Common | "event" | "evidenceHashes">;
export type DecisionInput = Pick<Decision, "findingId" | "reviewerId" | "status" | "reason" | "reviewRef" | "duplicateOf" | "requiredForApproval">;
export type RetirementInput = { findingId: string; reviewerId: string; reason: string; authorityRef: string };

function ensureId(value: unknown, name: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error(`${name} must be a short, non-sensitive identifier`);
  return value;
}

function ensureText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new Error(`${name} must be nonempty, printable text under 1000 characters`);
  }
  const text = value.trim();
  if (/(?:\bBearer\s+[\w.-]{12,}|\bsk_(?:test|live)_[\w-]{8,}|\bsk-[\w-]{16,}|\b(?:E2B_API_KEY|STAGING_E2E_ADMIN_TOKEN|CLERK_SECRET_KEY)\s*[:=]\s*[^\s,]{8,}|[?&](?:ticket|token|code)=[^\s&]+)/i.test(text)) {
    throw new Error(`${name} must not contain credentials or signed URLs`);
  }
  return text;
}

function ensureRef(ref: unknown, name: string): string {
  const text = ensureText(ref, name);
  if (text.length > 512 || path.isAbsolute(text) || text.includes("\\") || text.includes(":") ||
      text.split("/").some((part) => !part || part === "." || part === "..") || path.posix.normalize(text) !== text) {
    throw new Error(`${name} must be a clean QA_ROOT-relative path`);
  }
  return text;
}

function ensureIds(values: unknown, name: string, minimum = 0): string[] {
  if (!Array.isArray(values) || values.length < minimum) throw new Error(`${name} must be an array`);
  const parsed = values.map((value) => ensureId(value, name));
  if (new Set(parsed).size !== parsed.length) throw new Error(`${name} must not repeat IDs`);
  return parsed;
}

function ensureHash(value: unknown, name: string): EvidenceHash {
  const record = exactKeys(value, ["sha256", "size"], name);
  if (typeof record.sha256 !== "string" || !shaPattern.test(record.sha256) ||
      !Number.isSafeInteger(record.size) || Number(record.size) <= 0) {
    throw new Error(`${name} needs a SHA-256 digest and positive file size`);
  }
  return record as EvidenceHash;
}

function exactKeys(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${label} has unknown fields: ${unexpected.join(", ")}`);
  return record;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${name} is invalid`);
  return value as T;
}

function utc(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))) throw new Error(`${name} needs an ISO UTC timestamp`);
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

const sha = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

function parseInput(value: unknown): PlanInput {
  const record = exactKeys(value, ["schemaVersion", "runId", "targets", "mechanisms", "cases", "changeInventoryRef"], "plan");
  if (record.schemaVersion !== 1) throw new Error("Unsupported omission plan schema");
  const runId = ensureId(record.runId, "runId");
  const changeInventoryRef = record.changeInventoryRef === undefined ? undefined : ensureRef(record.changeInventoryRef, "changeInventoryRef");
  if (!Array.isArray(record.targets) || !record.targets.length) throw new Error("Plan needs at least one target");
  const targets = record.targets.map((entry) => {
    const target = exactKeys(entry, ["targetKey", "description", "sourceRef", "anchor", "changeIds"], "target");
    return { targetKey: ensureId(target.targetKey, "targetKey"), description: ensureText(target.description, "description"),
      sourceRef: ensureRef(target.sourceRef, "sourceRef"), anchor: ensureText(target.anchor, "anchor"),
      ...(target.changeIds === undefined ? {} : { changeIds: ensureIds(target.changeIds, "changeIds", 1) }) };
  });
  if (new Set(targets.map((target) => target.targetKey)).size !== targets.length) throw new Error("Duplicate targetKey");
  const targetKeys = new Set(targets.map((target) => target.targetKey));
  if (!Array.isArray(record.mechanisms)) throw new Error("mechanisms must be an array");
  const mechanisms = record.mechanisms.map((entry) => {
    const mechanism = exactKeys(entry, ["mechanismKey", "category", "targetKeys", "applicable", "generator"], "mechanism");
    const keys = ensureIds(mechanism.targetKeys, "mechanism.targetKeys", 1);
    if (keys.some((key) => !targetKeys.has(key))) throw new Error("Mechanism references an unknown targetKey");
    if (typeof mechanism.applicable !== "boolean") throw new Error("Mechanism applicability must be boolean");
    return { mechanismKey: ensureId(mechanism.mechanismKey, "mechanismKey"),
      category: choice(mechanism.category, ["happy", "negative", "edge"] as const, "category"),
      targetKeys: keys, applicable: mechanism.applicable,
      ...(mechanism.generator === undefined ? {} : { generator: choice(mechanism.generator, caseGenerators, "mechanism.generator") }) };
  });
  if (new Set(mechanisms.map((mechanism) => mechanism.mechanismKey)).size !== mechanisms.length) throw new Error("Duplicate mechanismKey");
  const mechanismsByKey = new Map(mechanisms.map((mechanism) => [mechanism.mechanismKey, mechanism]));
  if (!Array.isArray(record.cases)) throw new Error("cases must be an array");
  const cases = record.cases.map((entry) => {
    const item = exactKeys(entry, ["caseKey", "category", "mechanismKeys", "applicable", "lane"], "case");
    const category = choice(item.category, ["happy", "negative", "edge"] as const, "case.category");
    const keys = ensureIds(item.mechanismKeys, "case.mechanismKeys", 1);
    if (keys.some((key) => mechanismsByKey.get(key)?.category !== category)) {
      throw new Error("Case mechanisms must be planned and share the Case category");
    }
    const fromMechanisms = keys.some((key) => mechanismsByKey.get(key)?.applicable);
    if (item.applicable !== undefined && item.applicable !== fromMechanisms) {
      throw new Error("Case planned applicability differs from its mapped mechanisms");
    }
    return { caseKey: ensureId(item.caseKey, "caseKey"), category, mechanismKeys: keys,
      applicable: fromMechanisms, ...(item.lane === undefined ? {} : { lane: ensureId(item.lane, "case.lane") }) };
  });
  if (new Set(cases.map((item) => item.caseKey)).size !== cases.length) throw new Error("Duplicate caseKey");
  if (!changeInventoryRef && targets.some((target) => target.changeIds?.length)) {
    throw new Error("Target changeIds require a changeInventoryRef");
  }
  return { schemaVersion: 1, runId, ...(changeInventoryRef ? { changeInventoryRef } : {}), targets, mechanisms, cases };
}

async function readChangeInventory(root: string, plan: PlanInput): Promise<PrDiffInventory | undefined> {
  if (!plan.changeInventoryRef) return undefined;
  const inventory = validatePrDiffInventoryShape(
    JSON.parse(await readFile(await checkedPath(root, plan.changeInventoryRef), "utf8")));
  if (!inventory.changedFiles.length) throw new Error("PR inventory needs changed files for a Case plan");
  const inventoryIds = new Set(inventory.changedFiles.map((file) => file.changeId).filter((id): id is string => Boolean(id)));
  const mappedIds = new Set(plan.targets.flatMap((target) => target.changeIds ?? []));
  const unknown = [...mappedIds].filter((id) => !inventoryIds.has(id));
  if (unknown.length) throw new Error(`Plan target refers to unknown changed-file IDs: ${unknown.join(", ")}`);
  const unclassified = inventory.changedFiles.filter((file) => !file.changeId && !file.excludedReason);
  if (unclassified.length) throw new Error(`Changed files lack classification: ${unclassified.map((file) => file.filePath).join(", ")}`);
  const unmapped = inventory.changedFiles.filter((file) => !file.excludedReason && (!file.changeId || !mappedIds.has(file.changeId)));
  if (unmapped.length) throw new Error(`Changed files lack mapped targets or exclusion reasons: ${unmapped.map((file) => file.filePath).join(", ")}`);
  return inventory;
}

async function readPrSpecIdentity(root: string, run: RunRecord): Promise<{
  ref: string; repository: string; baseSha: string; headSha: string;
} | undefined> {
  const ref = `${run.runRoot}/tickets/pr-spec.json`;
  let file: string;
  try { file = await checkedPath(root, ref); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error("Frozen PR spec snapshot must be valid JSON"); }
  const snapshot = exactKeys(parsed, ["schemaVersion", "kind", "prUrl", "baseSha", "headSha", "capturedAt", "statements"], "PR spec snapshot");
  const match = typeof snapshot.prUrl === "string"
    ? /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/[1-9]\d*$/.exec(snapshot.prUrl)
    : null;
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== "pr_spec_snapshot" || !match ||
      typeof snapshot.baseSha !== "string" || !/^[a-f0-9]{40}$/.test(snapshot.baseSha) ||
      typeof snapshot.headSha !== "string" || !/^[a-f0-9]{40}$/.test(snapshot.headSha) ||
      typeof snapshot.capturedAt !== "string" || !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      !Array.isArray(snapshot.statements)) {
    throw new Error("PR spec snapshot needs PR URL, full base/head SHA, capture time and prose statements");
  }
  if (snapshot.headSha !== run.scope.deploymentSha) throw new Error("PR spec head SHA differs from the run deployment SHA");
  return { ref, repository: `${match[1]}/${match[2]}`.toLowerCase(), baseSha: snapshot.baseSha, headSha: snapshot.headSha };
}

function planCaseForMechanism(plan: OmissionPlan, mechanismKey: string, category: Category): PlanInput["cases"][number] | undefined {
  const mechanism = plan.mechanisms.find((item) => item.mechanismKey === mechanismKey &&
    item.category === category && item.applicable);
  return mechanism && plan.cases.find((item) => item.category === category && item.applicable &&
    item.mechanismKeys.includes(mechanismKey));
}

async function rootPath(qaRoot: string): Promise<string> {
  const root = await realpath(qaRoot);
  if (!(await stat(root)).isDirectory()) throw new Error("QA_ROOT must be a directory");
  return root;
}

async function directory(root: string, runId: string, create = false): Promise<string> {
  const ref = `.qa-loop/omissions/${ensureId(runId, "runId")}`;
  if (create) {
    for (const part of [".qa-loop", ".qa-loop/omissions", ref, `${ref}/events`]) {
      const target = path.join(root, part);
      try { await mkdir(target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await checkedPath(root, part, "directory");
    }
  } else await checkedPath(root, `${ref}/events`, "directory");
  return path.join(root, ref);
}

async function hashRef(root: string, ref: string): Promise<EvidenceHash> {
  const name = ensureRef(ref, "evidenceRef");
  const file = await checkedPath(root, name);
  const before = await stat(file);
  if (!before.size) throw new Error(`Evidence is empty: ${name}`);
  const content = await readFile(file);
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Evidence changed while hashing: ${name}`);
  return { sha256: createHash("sha256").update(content).digest("hex"), size: after.size };
}

async function hashRefs(root: string, refs: string[]): Promise<Record<string, EvidenceHash>> {
  const entries = await Promise.all([...new Set(refs)].map(async (ref) => [ref, await hashRef(root, ref)] as const));
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

async function verifyRefs(root: string, refs: Record<string, EvidenceHash>): Promise<void> {
  for (const [ref, expected] of Object.entries(refs)) {
    if (!shaPattern.test(expected.sha256) || !Number.isSafeInteger(expected.size) || expected.size <= 0 ||
        canonical(await hashRef(root, ref)) !== canonical(expected)) {
      throw new Error(`Frozen omission evidence changed: ${ref}`);
    }
  }
}

async function atomicCreate(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await link(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

async function withLock<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const lock = path.join(dir, ".lock");
  const token = randomUUID();
  let acquired = false;
  for (let i = 0; i < 100; i++) {
    try {
      await mkdir(lock);
      await writeFile(path.join(lock, "owner"), token, { flag: "wx" });
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await lstat(lock)).mtimeMs > 120_000) {
          const stale = `${lock}.${randomUUID()}.stale`;
          await rename(lock, stale);
          await rm(stale, { recursive: true, force: true });
        }
      } catch (race) { if ((race as NodeJS.ErrnoException).code !== "ENOENT") throw race; }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  if (!acquired) throw new Error("Omission ledger is busy");
  const heartbeat = setInterval(() => { const now = new Date(); void utimes(lock, now, now).catch(() => {}); }, 5_000);
  heartbeat.unref();
  try {
    const result = await action();
    if ((await readFile(path.join(lock, "owner"), "utf8")) !== token) throw new Error("Omission lock expired");
    return result;
  } finally {
    clearInterval(heartbeat);
    try {
      if ((await readFile(path.join(lock, "owner"), "utf8")) === token) {
        await rm(lock, { recursive: true, force: true });
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

/** A merged run's single plan assigns every Case to one of its declared lanes; other runs have no lanes. */
function assertPlanLanes(plan: PlanInput, run: RunRecord): void {
  if (!run.lanes) {
    if (plan.cases.some((item) => item.lane !== undefined)) throw new Error("Only a merged run's plan assigns Cases to lanes");
    return;
  }
  const declared = new Set(run.lanes);
  const unassigned = plan.cases.filter((item) => !item.lane || !declared.has(item.lane)).map((item) => item.caseKey);
  if (unassigned.length) {
    throw new Error(`Merged run plan must assign every Case to one of its lanes (${run.lanes.join(", ")}): ${unassigned.join(", ")}`);
  }
  const empty = run.lanes.filter((lane) => !plan.cases.some((item) => item.lane === lane));
  if (empty.length) throw new Error(`Lane has no planned Case: ${empty.join(", ")}`);
}

export async function freezeOmissionPlan(qaRoot: string, input: PlanInput, now = new Date(), repoPath?: string): Promise<OmissionPlan> {
  const root = await rootPath(qaRoot);
  const planInput = parseInput(input);
  const run = await inspectRun(root, planInput.runId);
  if (run.phase !== "planned") throw new Error("Original Case plan must be frozen while run is planned, before execution");
  assertPlanLanes(planInput, run);
  const prSpec = await readPrSpecIdentity(root, run);
  const changeInventory = await readChangeInventory(root, planInput);
  if (changeInventory) {
    if (!repoPath) throw new Error("PR Case plan freeze requires --repo-path to verify the exact base-to-head diff");
    if (!prSpec || changeInventory.repository !== prSpec.repository || changeInventory.baseSha !== prSpec.baseSha ||
        changeInventory.headSha !== prSpec.headSha) {
      throw new Error("PR change inventory repository/base/head differs from this run's frozen PR spec snapshot");
    }
    await verifyPrDiffInventory(root, repoPath, planInput.changeInventoryRef!, {
      repository: changeInventory.repository, baseSha: changeInventory.baseSha, headSha: changeInventory.headSha,
    });
  }
  const sourceHashes = await hashRefs(root, [run.refs.taskModel, ...planInput.targets.map((target) => target.sourceRef),
    ...(planInput.changeInventoryRef ? [planInput.changeInventoryRef] : []), ...(prSpec ? [prSpec.ref] : [])]);
  const ledger = `${run.runRoot}/run-state/human-review.jsonl`;
  const inventories = (await readHumanReviewLedger(root, ledger, { allowMissing: true }))
    .filter((event): event is BlindInventoryEvent => event.event === "blind_inventory");
  const inventory = inventories[0];
  if (inventory && (inventory.journeyKey !== run.journeyKey || inventory.executorId !== run.executorId ||
      inventory.reviewerId === run.executorId || Date.parse(inventory.createdAt) > now.getTime())) {
    throw new Error("Blind inventory does not precede this plan or match run identity");
  }
  const blindInventory = inventory ? {
    eventId: inventory.eventId, sha256: sha(inventory), mechanisms: inventory.mechanisms.map((item) => ({
      mechanismKey: item.mechanismKey, category: item.category, applicable: item.applicable,
    })),
  } : undefined;
  const body = {
    ...planInput, runRoot: run.runRoot, journeyKey: run.journeyKey, mode: run.mode, scope: run.scope,
    executorId: run.executorId, createdAt: now.toISOString(), sourceHashes,
    ...(blindInventory ? { blindInventory } : {}),
  };
  const plan: OmissionPlan = { ...body, digest: sha(body) };
  await atomicCreate(path.join(await directory(root, run.runId, true), "plan.json"), plan);
  return plan;
}

export async function readOmissionPlan(qaRoot: string, runId: string): Promise<OmissionPlan> {
  const root = await rootPath(qaRoot);
  const dir = await directory(root, runId);
  const file = await checkedPath(root, path.posix.join(".qa-loop/omissions", ensureId(runId, "runId"), "plan.json"));
  if (path.dirname(file) !== dir) throw new Error("Plan escaped run omission directory");
  const parsed = JSON.parse(await readFile(file, "utf8")) as OmissionPlan;
  const { digest, sourceHashes, blindInventory, runRoot, journeyKey, mode, scope, executorId, createdAt, ...body } = parsed;
  parseInput(body);
  if (parsed.runId !== runId || !shaPattern.test(digest) || sha({ ...body, runRoot, journeyKey, mode, scope, executorId,
    createdAt, sourceHashes, ...(blindInventory ? { blindInventory } : {}) }) !== digest) {
    throw new Error("Frozen omission plan digest mismatch");
  }
  const run = await inspectRun(root, runId);
  if (run.runRoot !== runRoot || run.journeyKey !== journeyKey || run.executorId !== executorId ||
      run.mode !== mode || canonical(run.scope) !== canonical(scope)) throw new Error("Plan does not match run registry");
  utc(createdAt, "plan.createdAt");
  if (!Object.hasOwn(sourceHashes, run.refs.taskModel)) throw new Error("Plan lacks task model hash");
  const refs = new Set([run.refs.taskModel, ...parsed.targets.map((target) => target.sourceRef),
    ...(parsed.changeInventoryRef ? [parsed.changeInventoryRef] : []),
    ...(Object.hasOwn(sourceHashes, `${runRoot}/tickets/pr-spec.json`) ? [`${runRoot}/tickets/pr-spec.json`] : [])]);
  if (canonical([...Object.keys(sourceHashes)].sort()) !== canonical([...refs].sort())) throw new Error("Plan source hash set differs");
  // The task model may gain execution notes. Its frozen digest remains provenance for the original plan.
  await verifyRefs(root, Object.fromEntries(Object.entries(sourceHashes).filter(([ref]) => ref !== run.refs.taskModel)));
  const currentSpec = await readPrSpecIdentity(root, run);
  const changeInventory = await readChangeInventory(root, parsed);
  if (changeInventory && (!currentSpec || !Object.hasOwn(sourceHashes, currentSpec.ref) ||
      changeInventory.repository !== currentSpec.repository || changeInventory.baseSha !== currentSpec.baseSha ||
      changeInventory.headSha !== currentSpec.headSha)) {
    throw new Error("PR inventory no longer matches the frozen PR spec identity");
  }
  if (blindInventory) {
    const events = await readHumanReviewLedger(root, `${runRoot}/run-state/human-review.jsonl`);
    const inventory = events.find((item): item is BlindInventoryEvent =>
      item.event === "blind_inventory" && item.eventId === blindInventory.eventId);
    if (!inventory || sha(inventory) !== blindInventory.sha256 || Date.parse(inventory.createdAt) > Date.parse(createdAt) ||
        canonical(inventory.mechanisms.map(({ mechanismKey, category, applicable }) => ({ mechanismKey, category, applicable }))) !==
        canonical(blindInventory.mechanisms)) throw new Error("Frozen blind inventory changed");
  }
  return parsed;
}

function parseEvent(value: unknown, plan: OmissionPlan): OmissionEvent {
  const base = exactKeys(value, ["schemaVersion", "eventId", "runId", "planDigest", "createdAt", "previousDigest", "digest", "event",
    "mechanismKey", "category", "targetKeys", "source", "actorId", "reason", "expectedAuthority", "evidenceRefs", "evidenceHashes",
    "findingId", "reviewerId", "status", "reviewRef", "reviewHash", "duplicateOf", "kind", "runIdVerified", "caseKey",
    "packetDigest", "authorityRef", "authorityHash", "requiredForApproval", "generator", "generatorGap"], "omission event");
  if (base.schemaVersion !== 1 || base.runId !== plan.runId || base.planDigest !== plan.digest) {
    throw new Error("Omission event run or plan digest mismatch");
  }
  ensureId(base.eventId, "eventId");
  utc(base.createdAt, "event.createdAt");
  if (base.previousDigest !== null && (typeof base.previousDigest !== "string" || !shaPattern.test(base.previousDigest))) {
    throw new Error("Omission previous event digest is invalid");
  }
  const { digest, ...content } = base;
  if (typeof digest !== "string" || !shaPattern.test(digest) || sha(content) !== digest) {
    throw new Error("Omission event digest mismatch");
  }
  const kind = choice(base.event, ["finding", "decision", "repair", "closure"] as const, "event");
  const allowed: Record<typeof kind, string[]> = {
    finding: ["mechanismKey", "category", "targetKeys", "source", "actorId", "reason", "expectedAuthority", "evidenceRefs", "evidenceHashes",
      "generator", "generatorGap"],
    decision: ["findingId", "reviewerId", "status", "reason", "reviewRef", "reviewHash", "duplicateOf", "requiredForApproval"],
    repair: ["findingId", "kind", "caseKey", "packetDigest"],
    closure: ["findingId", "kind", "runIdVerified", "caseKey", "packetDigest", "reviewerId", "reason", "authorityRef", "authorityHash"],
  };
  const common = ["schemaVersion", "eventId", "runId", "planDigest", "createdAt", "previousDigest", "digest", "event"];
  exactKeys(base, [...common, ...allowed[kind]], `${kind} event`);
  if (kind === "finding") {
    const mechanismKey = ensureId(base.mechanismKey, "mechanismKey");
    const category = choice(base.category, ["happy", "negative", "edge"] as const, "category");
    const targetKeys = ensureIds(base.targetKeys, "targetKeys", 1);
    if (targetKeys.some((key) => !plan.targets.some((target) => target.targetKey === key))) throw new Error("Unknown omission target");
    const planned = plan.mechanisms.find((mechanism) => mechanism.mechanismKey === mechanismKey);
    if (planned && (planned.category !== category || planned.targetKeys.some((key) => !targetKeys.includes(key)) ||
        plan.cases.some((item) => item.mechanismKeys.includes(mechanismKey)))) {
      throw new Error("This mechanism was already covered in the original plan");
    }
    if (!Array.isArray(base.evidenceRefs)) throw new Error("Finding evidenceRefs must be an array");
    const evidenceRefs = base.evidenceRefs.map((ref) => ensureRef(ref, "finding.evidenceRef"));
    if (!evidenceRefs.length || new Set(evidenceRefs).size !== evidenceRefs.length) throw new Error("Finding needs distinct evidence refs");
    const hashes = exactKeys(base.evidenceHashes, evidenceRefs, "finding evidence hashes") as Record<string, EvidenceHash>;
    if (canonical(Object.keys(hashes).sort()) !== canonical([...evidenceRefs].sort())) throw new Error("Finding evidence hash set differs");
    for (const [ref, value] of Object.entries(hashes)) ensureHash(value, `evidence hash ${ref}`);
    if ((base.generator === undefined) !== (base.generatorGap === undefined)) {
      throw new Error("Finding generator and generatorGap must be given together");
    }
    if (base.generatorGap !== undefined) {
      const gap = choice(base.generatorGap, ["material", "rule"] as const, "finding.generatorGap");
      choice(base.generator, gap === "material" ? caseGenerators : findingGenerators, `finding.generator for ${gap} gap`);
    }
    return { ...base, mechanismKey, category, targetKeys, evidenceRefs,
      source: choice(base.source, sources, "source"), actorId: ensureId(base.actorId, "actorId"),
      reason: ensureText(base.reason, "reason"), expectedAuthority: choice(base.expectedAuthority,
        ["ticket", "user", "active_model", "pr_spec", "unconfirmed"] as const, "expectedAuthority") } as Finding;
  }
  if (kind === "decision") {
    ensureId(base.findingId, "findingId"); ensureId(base.reviewerId, "reviewerId");
    ensureText(base.reason, "reason"); ensureRef(base.reviewRef, "reviewRef");
    if (!(base.reviewRef as string).startsWith(`${plan.runRoot}/run-state/`)) {
      throw new Error("Independent omission reviewRef must be a hashed record inside this run-state directory");
    }
    choice(base.status, ["confirmed", "rejected", "duplicate"] as const, "status");
    if ((base.status === "duplicate") !== Boolean(base.duplicateOf)) throw new Error("Only duplicate decisions need duplicateOf");
    if (base.duplicateOf) ensureId(base.duplicateOf, "duplicateOf");
    ensureHash(base.reviewHash, "reviewHash");
    if (base.status === "confirmed" ? typeof base.requiredForApproval !== "boolean" : base.requiredForApproval !== undefined) {
      throw new Error("Confirmed omissions must be independently marked requiredForApproval true/false");
    }
    return base as unknown as Decision;
  }
  if (kind === "repair") {
    ensureId(base.findingId, "findingId"); ensureId(base.caseKey, "caseKey");
    if (base.kind !== "repaired_current_run" || typeof base.packetDigest !== "string" || !shaPattern.test(base.packetDigest)) {
      throw new Error("Current-run repair needs a checker packet digest");
    }
    return base as unknown as Repair;
  }
  ensureId(base.findingId, "findingId");
  choice(base.kind, ["verified_case", "retired_with_authority"] as const, "closure.kind");
  if (base.kind === "verified_case") {
    ensureId(base.runIdVerified, "runIdVerified"); ensureId(base.caseKey, "caseKey");
    if (typeof base.packetDigest !== "string" || !shaPattern.test(base.packetDigest)) throw new Error("Closure needs packetDigest");
    if (base.reviewerId || base.reason || base.authorityRef || base.authorityHash) throw new Error("Verified closure has retirement-only fields");
  } else {
    ensureId(base.reviewerId, "reviewerId"); ensureText(base.reason, "reason"); ensureRef(base.authorityRef, "authorityRef");
    ensureHash(base.authorityHash, "authorityHash");
    if (base.runIdVerified || base.caseKey || base.packetDigest) throw new Error("Retirement has verified-case-only fields");
  }
  return base as unknown as Closure;
}

function replay(events: OmissionEvent[], plan: OmissionPlan): Map<string, { finding: Finding; decision?: Decision; repairs: Repair[]; closure?: Closure }> {
  const findings = new Map<string, { finding: Finding; decision?: Decision; repairs: Repair[]; closure?: Closure }>();
  const eventIds = new Set<string>();
  let lastTimestamp = "";
  let previousDigest: string | null = null;
  for (const event of events) {
    if (eventIds.has(event.eventId)) throw new Error("Duplicate omission eventId");
    eventIds.add(event.eventId);
    if (lastTimestamp && event.createdAt < lastTimestamp) throw new Error("Omission events must be append-monotonic by timestamp");
    lastTimestamp = event.createdAt;
    if (event.previousDigest !== previousDigest) throw new Error("Omission event hash chain is broken");
    previousDigest = event.digest;
    if (event.event === "finding") {
      findings.set(event.eventId, { finding: event, repairs: [] });
      continue;
    }
    const item = findings.get(event.findingId);
    if (!item) throw new Error(`Omission event references an unknown finding: ${event.findingId}`);
    if (event.event === "decision") {
      if (item.decision) throw new Error("Omission finding has multiple decisions");
      if (event.reviewerId === plan.executorId || event.reviewerId === item.finding.actorId) {
        throw new Error("A finding cannot be independently adjudicated by its author/executor");
      }
      if (event.status === "duplicate") {
        const original = findings.get(event.duplicateOf!);
        if (!original || original.decision?.status !== "confirmed" ||
            original.finding.mechanismKey !== item.finding.mechanismKey) {
          throw new Error("Duplicate must refer to an earlier confirmed finding of the same mechanism");
        }
      }
      if (event.status === "confirmed" && [...findings.values()].some((other) => other !== item &&
          other.decision?.status === "confirmed" && other.finding.mechanismKey === item.finding.mechanismKey)) {
        throw new Error("Confirm an existing finding only once; mark later observations duplicate");
      }
      item.decision = event;
      continue;
    }
    if (item.decision?.status !== "confirmed") throw new Error("Only a confirmed finding can be repaired or closed");
    if (event.event === "repair") {
      if (item.repairs.some((previous) => previous.packetDigest === event.packetDigest) || item.closure) {
        throw new Error("Current-run repair was already recorded for this packet or finding is closed");
      }
      item.repairs.push(event);
      continue;
    }
    if (item.closure) throw new Error("Only an open confirmed finding can close");
    if (event.kind === "retired_with_authority" && (event.reviewerId === plan.executorId || event.reviewerId === item.finding.actorId)) {
      throw new Error("A finding cannot be retired by its author/executor");
    }
    item.closure = event;
  }
  return findings;
}

function pendingTriage(plan: OmissionPlan, findings: ReturnType<typeof replay>) {
  const reviewed = new Set([...findings.values()].filter((item) => item.decision)
    .map((item) => `${item.finding.category}/${item.finding.mechanismKey}`));
  return {
    unadjudicatedBlindMechanismKeys: (plan.blindInventory?.mechanisms ?? [])
      .filter((item) => item.applicable && !planCaseForMechanism(plan, item.mechanismKey, item.category) &&
        !reviewed.has(`${item.category}/${item.mechanismKey}`))
      .map((item) => item.mechanismKey),
    unadjudicatedUnassignedMechanismKeys: plan.mechanisms
      .filter((item) => item.applicable && !planCaseForMechanism(plan, item.mechanismKey, item.category) &&
        !reviewed.has(`${item.category}/${item.mechanismKey}`))
      .map((item) => item.mechanismKey),
    unadjudicatedFindingIds: [...findings.values()].filter((item) => !item.decision)
      .map((item) => item.finding.eventId),
  };
}

async function eventsFor(root: string, plan: OmissionPlan): Promise<OmissionEvent[]> {
  const dir = await directory(root, plan.runId);
  const eventDir = path.join(dir, "events");
  const files = (await readdir(eventDir)).filter((name) => name.endsWith(".json")).sort();
  const events: OmissionEvent[] = [];
  for (const [i, name] of files.entries()) {
    if (!new RegExp(`^${String(i + 1).padStart(6, "0")}-[a-zA-Z0-9._-]+\\.json$`).test(name)) {
      throw new Error("Omission ledger event sequence has a gap or invalid filename");
    }
    const file = await checkedPath(root, `.qa-loop/omissions/${plan.runId}/events/${name}`);
    const event = parseEvent(JSON.parse(await readFile(file, "utf8")), plan);
    if (name !== `${String(i + 1).padStart(6, "0")}-${event.eventId}.json`) throw new Error("Omission event filename and eventId differ");
    events.push(event);
  }
  replay(events, plan);
  return events;
}

async function appendEvent(root: string, plan: OmissionPlan, event: UnsealedEvent): Promise<OmissionEvent> {
  const dir = await directory(root, plan.runId);
  return withLock(dir, async () => {
    const events = await eventsFor(root, plan);
    const body = { ...event, previousDigest: events.at(-1)?.digest ?? null };
    const sealed = parseEvent({ ...body, digest: sha(body) }, plan);
    const candidate = [...events, sealed];
    replay(candidate, plan);
    await atomicCreate(path.join(dir, "events", `${String(candidate.length).padStart(6, "0")}-${sealed.eventId}.json`), sealed);
    return sealed;
  });
}

function eventBase(plan: OmissionPlan, now: Date): Omit<Common, "previousDigest" | "digest"> {
  return { schemaVersion: 1, eventId: randomUUID(), runId: plan.runId, planDigest: plan.digest, createdAt: now.toISOString() };
}

export async function findOmission(qaRoot: string, runId: string, input: FindingInput, now = new Date()): Promise<Finding> {
  const plan = await readOmissionPlan(qaRoot, runId);
  const root = await rootPath(qaRoot);
  const run = await inspectRun(root, runId);
  if (run.phase === "planned" && !["self_critic", "human"].includes(input.source)) {
    throw new Error("Only planning self-critique or human feedback can precede execution");
  }
  if (["self_critic", "execution_discovery"].includes(input.source) && input.actorId !== plan.executorId) {
    throw new Error("Self/execute omission source must be this run's executor");
  }
  if (["checker", "human", "escaped_defect"].includes(input.source) && input.actorId === plan.executorId) {
    throw new Error("Independent finding source cannot be this run's executor");
  }
  const event = { ...eventBase(plan, now), event: "finding", ...input,
    evidenceHashes: await hashRefs(root, input.evidenceRefs) } as UnsealedEvent;
  return await appendEvent(root, plan, event) as Finding;
}

export async function decideOmission(qaRoot: string, runId: string, input: DecisionInput, now = new Date()): Promise<Decision> {
  const plan = await readOmissionPlan(qaRoot, runId);
  const root = await rootPath(qaRoot);
  const event = { ...eventBase(plan, now), event: "decision", ...input,
    reviewHash: await hashRef(root, input.reviewRef) } as UnsealedEvent;
  return await appendEvent(root, plan, event) as Decision;
}

async function verifiedRepair(root: string, plan: OmissionPlan, finding: Finding, repairRunId: string) {
  const run = await inspectRun(root, repairRunId);
  if (run.runId === plan.runId || !["reviewed", "published"].includes(run.phase) ||
      run.journeyKey !== plan.journeyKey || run.scope.environment !== plan.scope.environment ||
      run.scope.role !== plan.scope.role || run.scope.orgAlias !== plan.scope.orgAlias ||
      Date.parse(run.createdAt) <= Date.parse(plan.createdAt)) {
    throw new Error("Closure needs a subsequent, comparable, independently reviewed run");
  }
  const laterPlan = await readOmissionPlan(root, repairRunId);
  const cases = laterPlan.cases.filter((item) => item.mechanismKeys.includes(finding.mechanismKey));
  if (!cases.length) throw new Error("Later original plan did not cover the omitted mechanism");
  if (!run.refs.checkerPacket || !run.refs.checkerReview) throw new Error("Later run lacks independent checker packet/review");
  const packet = await verifyCheckerPacket(root,
    JSON.parse(await readFile(await checkedPath(root, run.refs.checkerPacket), "utf8")) as CheckerPacket);
  const review = JSON.parse(await readFile(await checkedPath(root, run.refs.checkerReview), "utf8")) as CheckerReview;
  await checkReviewerDecision(root, packet, review);
  if (packet.runId !== run.runId || packet.journeyKey !== plan.journeyKey || packet.runRoot !== run.runRoot ||
      packet.executorId !== run.executorId || canonical(packet.scope) !== canonical(run.scope)) {
    throw new Error("Later checker packet differs from run identity");
  }
  const matched = cases.find(({ caseKey }) => packet.cases.some((item) => item.caseKey === caseKey && item.applicable &&
    item.executed && ["Pass", "ProductFail", "Product bug"].includes(item.status) && item.category === finding.category &&
    item.evidenceRefs.some((ref) => Object.hasOwn(packet.files, ref)) &&
    review.caseReviews.some((entry) => entry.id === item.id && entry.disposition === "upheld")));
  if (!matched) throw new Error("Later run lacks a terminal, independently upheld Case with frozen evidence");
  return { caseKey: matched.caseKey, packetDigest: packet.digest };
}

export async function recordCurrentRunRepair(qaRoot: string, runId: string, findingId: string,
  now = new Date()): Promise<Repair> {
  const plan = await readOmissionPlan(qaRoot, runId);
  const root = await rootPath(qaRoot);
  const run = await inspectRun(root, runId);
  if (!["reviewed", "published"].includes(run.phase) || !run.refs.checkerPacket || !run.refs.checkerReview) {
    throw new Error("Current-run repair needs an independently reviewed run");
  }
  const finding = replay(await eventsFor(root, plan), plan).get(ensureId(findingId, "findingId"))?.finding;
  if (!finding) throw new Error("Unknown omission finding");
  const packet = await verifyCheckerPacket(root,
    JSON.parse(await readFile(await checkedPath(root, run.refs.checkerPacket), "utf8")) as CheckerPacket);
  const review = JSON.parse(await readFile(await checkedPath(root, run.refs.checkerReview), "utf8")) as CheckerReview;
  await checkReviewerDecision(root, packet, review);
  if (packet.runId !== runId || packet.runRoot !== plan.runRoot || packet.journeyKey !== plan.journeyKey ||
      packet.executorId !== plan.executorId || canonical(packet.scope) !== canonical(plan.scope)) {
    throw new Error("Current checker packet differs from run identity");
  }
  // This is an execution repair only. The original design denominator remains unchanged.
  const repaired = packet.cases.find((item) => item.caseKey === finding.mechanismKey && item.category === finding.category &&
    item.applicable && item.executed && ["Pass", "ProductFail", "Product bug"].includes(item.status) &&
    item.evidenceRefs.some((ref) => Object.hasOwn(packet.files, ref)) &&
    review.caseReviews.some((entry) => entry.id === item.id && entry.disposition === "upheld"));
  if (!repaired) throw new Error("Current run lacks a terminal, independently upheld Case keyed by the missed mechanism");
  const event = { ...eventBase(plan, now), event: "repair", findingId,
    kind: "repaired_current_run", caseKey: repaired.caseKey, packetDigest: packet.digest } as UnsealedEvent;
  return await appendEvent(root, plan, event) as Repair;
}

export async function checkOmissionApproval(qaRoot: string, runId: string, packetRef: string, reviewRef: string) {
  const { plan, events } = await readOmissionLedger(qaRoot, runId);
  const root = await rootPath(qaRoot);
  const run = await inspectRun(root, runId);
  if (!run.refs.checkerPacket || !run.refs.checkerReview ||
      run.refs.checkerPacket !== packetRef || run.refs.checkerReview !== reviewRef ||
      !["awaiting_review", "reviewed", "published"].includes(run.phase)) {
    throw new Error("Omission gate must use the current independently reviewed packet/review registered for this run");
  }
  const packet = await verifyCheckerPacket(root,
    JSON.parse(await readFile(await checkedPath(root, packetRef), "utf8")) as CheckerPacket);
  const review = JSON.parse(await readFile(await checkedPath(root, reviewRef), "utf8")) as CheckerReview;
  const checker = await checkReviewerDecision(root, packet, review);
  const prSpec = await readPrSpecIdentity(root, run);
  if (packet.runId !== runId || packet.runRoot !== plan.runRoot || packet.journeyKey !== plan.journeyKey ||
      packet.executorId !== plan.executorId || canonical(packet.scope) !== canonical(plan.scope)) {
    throw new Error("Omission gate packet differs from frozen run identity");
  }
  const findings = replay(events, plan);
  const triage = pendingTriage(plan, findings);
  const plannedCases = plan.cases.map((planned) => ({ planned,
    actual: packet.cases.find((candidate) => candidate.caseKey === planned.caseKey) }));
  const laneOwner = (caseId: number) => packet.lanes?.find((lane) => lane.caseIds.includes(caseId))?.lane;
  const plannedCaseLaneMismatchKeys = plannedCases.filter(({ planned, actual }) => actual && planned.lane !== undefined &&
    laneOwner(actual.id) !== planned.lane).map(({ planned }) => planned.caseKey);
  const missingPlannedCaseKeys = plannedCases.filter(({ actual }) => !actual).map(({ planned }) => planned.caseKey);
  const plannedCaseCategoryMismatchKeys = plannedCases.filter(({ planned, actual }) => actual &&
    actual.category !== planned.category).map(({ planned }) => planned.caseKey);
  const plannedApplicableNotPassedKeys = plan.mechanisms.filter((mechanism) => mechanism.applicable &&
    !plan.cases.filter((item) => item.category === mechanism.category && item.applicable &&
      item.mechanismKeys.includes(mechanism.mechanismKey)).every((item) => {
      const actual = packet.cases.find((candidate) => candidate.caseKey === item.caseKey &&
        candidate.category === item.category);
      return actual?.applicable === true && actual.executed && actual.status === "Pass";
    })).map((item) => item.mechanismKey);
  const unassignedApplicableMechanismKeys = plan.mechanisms.filter((item) => item.applicable &&
    !planCaseForMechanism(plan, item.mechanismKey, item.category)).map((item) => item.mechanismKey);
  const orphanTargetKeys = plan.targets.filter((target) => !plan.mechanisms.some((mechanism) =>
    mechanism.applicable && mechanism.targetKeys.includes(target.targetKey))).map((target) => target.targetKey);
  const requirements = [...findings.values()]
    .filter((item) => item.decision?.status === "confirmed" && item.decision.requiredForApproval &&
      item.closure?.kind !== "retired_with_authority");
  const missing = requirements.filter((item) => !packet.cases.some((candidate) =>
    candidate.caseKey === item.finding.mechanismKey && candidate.category === item.finding.category &&
    candidate.applicable && candidate.executed && ["Pass", "ProductFail", "Product bug"].includes(candidate.status) &&
    candidate.evidenceRefs.some((ref) => Object.hasOwn(packet.files, ref)) &&
    review.caseReviews.some((entry) => entry.id === candidate.id && entry.disposition === "upheld")));
  const prPlanChangedAfterFreeze = Boolean(plan.changeInventoryRef &&
    canonical(await hashRef(root, run.refs.taskModel)) !== canonical(plan.sourceHashes[run.refs.taskModel]));
  const prInventoryUnverified = Boolean(prSpec && (!plan.changeInventoryRef ||
    !Object.hasOwn(plan.sourceHashes, prSpec.ref)));
  const passBlocked = Boolean(missing.length || prPlanChangedAfterFreeze ||
    prInventoryUnverified || missingPlannedCaseKeys.length || plannedCaseCategoryMismatchKeys.length ||
    plannedCaseLaneMismatchKeys.length ||
    plannedApplicableNotPassedKeys.length || unassignedApplicableMechanismKeys.length || orphanTargetKeys.length ||
    triage.unadjudicatedBlindMechanismKeys.length || triage.unadjudicatedFindingIds.length);
  const artifactComplete = !missingPlannedCaseKeys.length && !plannedCaseCategoryMismatchKeys.length &&
    !plannedCaseLaneMismatchKeys.length;
  return {
    runId, packetDigest: packet.digest, qaApprovalReady: checker.qaApprovalEligible && !passBlocked,
    artifactPublishable: checker.artifactPublishable && artifactComplete &&
      (packet.reportOutcome !== "通过" || !passBlocked),
    missingPlannedCaseKeys, plannedCaseCategoryMismatchKeys, plannedCaseLaneMismatchKeys, plannedApplicableNotPassedKeys,
    unassignedApplicableMechanismKeys, orphanTargetKeys,
    requiredOmissionKeys: requirements.map((item) => item.finding.mechanismKey),
    requiredNotCoveredKeys: missing.map((item) => item.finding.mechanismKey),
    ...triage,
    prPlanChangedAfterFreeze, prInventoryUnverified,
    note: "Blind misses and candidate findings need independent triage even when a terminal Case was later added; this does not prove complete business coverage.",
  };
}

export async function closeOmissionWithCase(qaRoot: string, runId: string, findingId: string, repairRunId: string,
  now = new Date()): Promise<Closure> {
  const plan = await readOmissionPlan(qaRoot, runId);
  const root = await rootPath(qaRoot);
  const finding = replay(await eventsFor(root, plan), plan).get(ensureId(findingId, "findingId"))?.finding;
  if (!finding) throw new Error("Unknown omission finding");
  const verified = await verifiedRepair(root, plan, finding, ensureId(repairRunId, "repairRunId"));
  const closure = { ...eventBase(plan, now), event: "closure", findingId,
    kind: "verified_case", runIdVerified: repairRunId, ...verified } as UnsealedEvent;
  return await appendEvent(root, plan, closure) as Closure;
}

export async function retireOmission(qaRoot: string, runId: string, input: RetirementInput, now = new Date()): Promise<Closure> {
  const plan = await readOmissionPlan(qaRoot, runId);
  const root = await rootPath(qaRoot);
  const closure = { ...eventBase(plan, now), event: "closure", ...input,
    kind: "retired_with_authority", authorityHash: await hashRef(root, input.authorityRef) } as UnsealedEvent;
  return await appendEvent(root, plan, closure) as Closure;
}

export async function readOmissionLedger(qaRoot: string, runId: string): Promise<{ plan: OmissionPlan; events: OmissionEvent[] }> {
  const plan = await readOmissionPlan(qaRoot, runId);
  const root = await rootPath(qaRoot);
  const events = await eventsFor(root, plan);
  for (const event of events) {
    if (event.event === "finding") await verifyRefs(root, event.evidenceHashes);
    if (event.event === "decision") await verifyRefs(root, { [event.reviewRef]: event.reviewHash });
    if (event.event === "closure" && event.kind === "retired_with_authority") {
      await verifyRefs(root, { [event.authorityRef!]: event.authorityHash! });
    }
    if (event.event === "closure" && event.kind === "verified_case") {
      const finding = replay(events.slice(0, events.indexOf(event)), plan).get(event.findingId)?.finding;
      if (!finding) throw new Error("Verified closure has no original finding");
      const current = await verifiedRepair(root, plan, finding, event.runIdVerified!);
      if (current.packetDigest !== event.packetDigest || current.caseKey !== event.caseKey) {
        throw new Error("Later-run closure no longer matches current frozen review evidence");
      }
    }
  }
  return { plan, events };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

export async function summarizeOmissions(qaRoot: string, runId: string) {
  const { plan, events } = await readOmissionLedger(qaRoot, runId);
  const root = await rootPath(qaRoot);
  const inventoryFiles = (await readChangeInventory(root, plan))?.changedFiles ?? [];
  const mappedChangeIds = new Set(plan.targets.flatMap((target) => target.changeIds ?? []));
  const taskModelHash = await hashRef(root, (await inspectRun(root, runId)).refs.taskModel);
  const registry = replay(events, plan);
  const findings = [...registry.values()];
  const triage = pendingTriage(plan, registry);
  const mapped = new Set(plan.cases.filter((item) => item.applicable).flatMap((item) => item.mechanismKeys));
  const unassigned = plan.mechanisms.filter((item) => item.applicable &&
    !planCaseForMechanism(plan, item.mechanismKey, item.category))
    .map((item) => item.mechanismKey);
  const orphanTargetKeys = plan.targets.filter((target) => !plan.mechanisms.some((mechanism) =>
    mechanism.applicable && mechanism.targetKeys.includes(target.targetKey))).map((target) => target.targetKey);
  const confirmed = findings.filter((item) => item.decision?.status === "confirmed");
  const required = confirmed.filter((item) => item.decision?.requiredForApproval);
  const record = await inspectRun(root, runId);
  const currentPacket = record.refs.checkerPacket && ["reviewed", "published"].includes(record.phase)
    ? await verifyCheckerPacket(root,
      JSON.parse(await readFile(await checkedPath(root, record.refs.checkerPacket), "utf8")) as CheckerPacket)
    : undefined;
  const currentlyRepaired = (item: typeof confirmed[number]) => item.repairs.some((repair) => repair.packetDigest === currentPacket?.digest);
  const sourceMetrics = Object.fromEntries(sources.map((source) => {
    const subset = findings.filter((item) => item.finding.source === source);
    const adjudicated = subset.filter((item) => ["confirmed", "rejected"].includes(item.decision?.status ?? ""));
    return [source, { proposed: subset.length, confirmed: adjudicated.filter((item) => item.decision?.status === "confirmed").length,
      rejected: adjudicated.filter((item) => item.decision?.status === "rejected").length,
      duplicate: subset.filter((item) => item.decision?.status === "duplicate").length,
      unresolved: subset.filter((item) => !item.decision).length,
      adjudicatedPrecision: ratio(adjudicated.filter((item) => item.decision?.status === "confirmed").length, adjudicated.length) }];
  })) as Record<OmissionSource, { proposed: number; confirmed: number; rejected: number; duplicate: number;
    unresolved: number; adjudicatedPrecision: number | null }>;
  const inventory = plan.blindInventory?.mechanisms.filter((item) => item.applicable) ?? [];
  const covered = inventory.filter((item) => Boolean(planCaseForMechanism(plan, item.mechanismKey, item.category))).length;
  const edgeInventory = inventory.filter((item) => item.category === "edge");
  const generatorIds = [...findingGenerators].filter((id) => plan.mechanisms.some((item) => item.generator === id) ||
    findings.some((item) => item.finding.generator === id));
  const byGenerator = {
    generators: Object.fromEntries(generatorIds.map((id) => {
      const misses = confirmed.filter((item) => item.finding.generator === id);
      return [id, { plannedMechanisms: plan.mechanisms.filter((item) => item.applicable && item.generator === id).length,
        confirmedMisses: misses.length,
        misses: { material: misses.filter((item) => item.finding.generatorGap === "material").length,
          rule: misses.filter((item) => item.finding.generatorGap === "rule").length } }];
    })) as Partial<Record<FindingGenerator, { plannedMechanisms: number; confirmedMisses: number;
      misses: { material: number; rule: number } }>>,
    unattributedPlannedMechanisms: plan.mechanisms.filter((item) => item.applicable && !item.generator).length,
    unattributedConfirmedMisses: confirmed.filter((item) => !item.finding.generator).length,
  };
  return {
    runId, planDigest: plan.digest, journeyKey: plan.journeyKey, mode: plan.mode, scope: plan.scope,
    originalPlan: { targets: plan.targets.length, mechanisms: plan.mechanisms.length, cases: plan.cases.length,
      mappedMechanisms: mapped.size, unassignedMechanismKeys: unassigned, orphanTargetKeys,
      taskModelEditedAfterFreeze: canonical(taskModelHash) !== canonical(plan.sourceHashes[(await inspectRun(root, runId)).refs.taskModel]) },
    changedFileCoverage: { declared: inventoryFiles.length,
      mapped: inventoryFiles.filter((item) => item.changeId && mappedChangeIds.has(item.changeId)).length,
      excluded: inventoryFiles.filter((item) => item.excludedReason && (!item.changeId || !mappedChangeIds.has(item.changeId))).length,
      unmappedChangedFiles: inventoryFiles.filter((item) => !item.excludedReason && (!item.changeId || !mappedChangeIds.has(item.changeId)))
        .map((item) => item.filePath),
      prInventoryUnverified: Boolean((await readPrSpecIdentity(root, record)) && !plan.changeInventoryRef),
      caveat: "Declared inventory mapping does not prove completeness against the actual PR base-to-head diff or business coverage." },
    findings: { proposed: findings.length, candidate: findings.filter((item) => !item.decision).length,
      confirmed: confirmed.length, rejected: findings.filter((item) => item.decision?.status === "rejected").length,
      duplicate: findings.filter((item) => item.decision?.status === "duplicate").length,
      confirmedMechanismKeys: confirmed.map((item) => item.finding.mechanismKey), bySource: sourceMetrics,
      unadjudicatedFindingIds: triage.unadjudicatedFindingIds,
      unadjudicatedUnassignedMechanismKeys: triage.unadjudicatedUnassignedMechanismKeys,
      requiredForApprovalKeys: required.map((item) => item.finding.mechanismKey),
      requiredWithoutRecordedCurrentRepairKeys: required.filter((item) => !currentlyRepaired(item) &&
        item.closure?.kind !== "retired_with_authority").map((item) => item.finding.mechanismKey),
      expectedStillUnconfirmed: confirmed.filter((item) => item.finding.expectedAuthority === "unconfirmed")
        .map((item) => item.finding.mechanismKey) },
    repair: { confirmed: confirmed.length, verifiedCases: confirmed.filter((item) => item.closure?.kind === "verified_case").length,
      repairedCurrentRun: confirmed.filter(currentlyRepaired).length,
      staleCurrentRunRepairRecords: confirmed.reduce((sum, item) => sum + item.repairs.filter((repair) =>
        repair.packetDigest !== currentPacket?.digest).length, 0),
      retiredWithAuthority: confirmed.filter((item) => item.closure?.kind === "retired_with_authority").length,
      openMechanismKeys: confirmed.filter((item) => !item.closure).map((item) => item.finding.mechanismKey),
      verifiedClosureRate: ratio(confirmed.filter((item) => item.closure?.kind === "verified_case").length, confirmed.length) },
    independentBlindInventory: { available: Boolean(plan.blindInventory), applicableMechanisms: plan.blindInventory ? inventory.length : null,
      unadjudicatedBlindMechanismKeys: triage.unadjudicatedBlindMechanismKeys,
      planRecall: plan.blindInventory ? ratio(covered, inventory.length) : null,
      edgePlanRecall: plan.blindInventory ? ratio(edgeInventory.filter((item) =>
        Boolean(planCaseForMechanism(plan, item.mechanismKey, item.category))).length,
        edgeInventory.length) : null,
      missedMechanismKeys: plan.blindInventory ? inventory.filter((item) =>
        !planCaseForMechanism(plan, item.mechanismKey, item.category)).map((item) => item.mechanismKey) : [] },
    byGenerator,
    limitations: ["Confirmed omission means independently adjudicated missing test mechanism, not a proven product bug.",
      "Same-run repair records execution recovery but does not erase the original design omission or close the later regression gap.",
      "Precision uses independently adjudicated nonduplicate findings only; unresolved candidates are excluded.",
      "Recall measures the original frozen plan against a pre-plan independent blind inventory; absent inventory returns null."],
  };
}
