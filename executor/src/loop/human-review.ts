import { appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertQaRef } from "./state";
import { runRootOfRef } from "./run-root";
import { verifyCheckerPacket, type CheckerPacket } from "./checker";

export const designAxes = [
  "authoritativeExpected",
  "distinctMechanism",
  "businessTerminal",
  "evidencePlan",
  "fixtureAndCleanup",
] as const;

export const executionAxes = [
  "identityAndEnvironment",
  "journeyAndTerminal",
  "factsAgainstExpected",
  "evidenceAndVideo",
  "diagnosisAndCleanup",
] as const;

export type ScoreAxis = typeof designAxes[number] | typeof executionAxes[number];
export type DesignScoreCard = Record<typeof designAxes[number], 0 | 1 | 2>;
export type ExecutionScoreCard = Record<typeof executionAxes[number], 0 | 1 | 2>;
export type ScoreCard = DesignScoreCard | ExecutionScoreCard;
export type CaseCategory = "happy" | "negative" | "edge";
export type HumanReviewDecision = "accept" | "revise" | "insufficient";

type CommonEvent = {
  schemaVersion: 1;
  event: "blind_inventory" | "case_review" | "pm_decision";
  eventId: string;
  runId: string;
  reviewerId: string;
  createdAt: string;
  executorId: string;
};

export type Mechanism = {
  mechanismKey: string;
  description: string;
  category: CaseCategory;
  applicable: boolean;
  appliesWhen: string;
  authorityRef: string;
  risk: "low" | "medium" | "high";
};

export type BlindInventoryEvent = CommonEvent & {
  event: "blind_inventory";
  inventoryId: string;
  journeyKey: string;
  source: "human_qa" | "pm";
  /** This must be true only when the reviewer did not see the agent's case plan. */
  blind: true;
  mechanisms: Mechanism[];
  notes?: string;
};

export type CaseReviewEvent = CommonEvent & {
  event: "case_review";
  caseKey: string;
  packetDigest: string;
  category: CaseCategory;
  applicable: boolean;
  mechanismKeys: string[];
  status: HumanReviewDecision;
  design: DesignScoreCard;
  execution: ExecutionScoreCard;
  feedback: string;
  gapCodes: string[];
  samplingStrata: ("high_risk" | "failure_or_blocked" | "disputed_expected" | "new_negative_or_edge" | "stable_pass_sample")[];
  /** A later review may replace this event, but it must say why. */
  supersedesReviewId?: string;
};

export type PmDecisionEvent = CommonEvent & {
  event: "pm_decision";
  candidateKey: string;
  decision: "promote" | "reject" | "defer";
  authorityRef: string;
  reason: string;
  supersedesDecisionId?: string;
};

export type HumanReviewEvent = BlindInventoryEvent | CaseReviewEvent | PmDecisionEvent;
export type HumanReviewInput =
  | (Omit<BlindInventoryEvent, "eventId"> & { eventId?: string })
  | (Omit<CaseReviewEvent, "eventId"> & { eventId?: string })
  | (Omit<PmDecisionEvent, "eventId"> & { eventId?: string });

export type HumanReviewSummary = {
  runId: string;
  packetDigests: string[];
  sample: {
    packetCases: number | null;
    reviewedCases: number;
    coverage: number | null;
    fullPlanReviewed: boolean;
    unreviewedCaseKeys: string[];
    unreviewedFailureOrNewNegativeEdgeKeys: string[];
  };
  inventory: {
    available: boolean;
    blind: boolean;
    mechanismCount: number;
    applicableMechanismCount: number;
    byCategory: Record<CaseCategory, number>;
  };
  cases: {
    reviewed: number;
    applicable: number;
    byCategory: Record<CaseCategory, number>;
    designAverage: number | null;
    executionAverage: number | null;
    designPassRate: number | null;
    executionPassRate: number | null;
    designAcceptanceRate: number | null;
    mechanismPrecision: number | null;
    mechanismRecall: number | null;
    edgeMechanismRecall: number | null;
    sampleStrata: Record<CaseReviewEvent["samplingStrata"][number], number>;
  };
  noCountGaming: {
    duplicateMechanismsCollapsed: number;
    duplicateCaseReviewsRejected: number;
    denominatorLocked: true;
    notes: string[];
  };
};

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const LEDGER_SUFFIX = "run-state/human-review.jsonl";
const LEDGER_RULE = "human review ledger must be [<surface>/]<feature>/runs/<runId>/run-state/human-review.jsonl under QA_ROOT";

/** RunId of a ledger path that follows the shared run root rule (run-root.ts), else null. */
function ledgerRunId(ledgerRef: string): string | null {
  if (typeof ledgerRef !== "string" || ledgerRef.includes("..") || path.isAbsolute(ledgerRef)) return null;
  return runRootOfRef(ledgerRef, LEDGER_SUFFIX)?.runId ?? null;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty`);
  return value.trim();
}

function id(value: unknown, label: string): string {
  const result = nonempty(value, label);
  if (!idPattern.test(result)) throw new Error(`${label} must be a short non-sensitive identifier`);
  return result;
}

function timestamp(value: unknown, label: string): string {
  const result = nonempty(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
  return result;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new Error(`${label} is invalid`);
  return value as T;
}

function scoreCard<T extends readonly ScoreAxis[]>(value: unknown, axes: T, label: string): Record<T[number], 0 | 1 | 2> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const card = value as Record<string, unknown>;
  for (const axis of axes) {
    if (!Number.isInteger(card[axis]) || Number(card[axis]) < 0 || Number(card[axis]) > 2) {
      throw new Error(`${label}.${axis} must be an integer from 0 to 2`);
    }
  }
  const unexpected = Object.keys(card).filter((key) => !axes.includes(key as ScoreAxis));
  if (unexpected.length) throw new Error(`${label} has unknown axes: ${unexpected.join(", ")}`);
  return card as Record<T[number], 0 | 1 | 2>;
}

function stringList(value: unknown, label: string, min = 0): string[] {
  if (!Array.isArray(value) || value.length < min) throw new Error(`${label} must be an array`);
  const result = value.map((entry, index) => nonempty(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`);
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${label} has unknown fields: ${unexpected.join(", ")}`);
}

const commonKeys = ["schemaVersion", "event", "eventId", "runId", "reviewerId", "executorId", "createdAt"];

function assertRecordCommon(value: unknown): Record<string, unknown> {
  const record = object(value, "review event");
  if (record.schemaVersion !== 1) throw new Error("review event schemaVersion must be 1");
  oneOf(record.event, ["blind_inventory", "case_review", "pm_decision"] as const, "event");
  id(record.eventId, "eventId");
  id(record.runId, "runId");
  id(record.reviewerId, "reviewerId");
  id(record.executorId, "executorId");
  timestamp(record.createdAt, "createdAt");
  if (record.reviewerId === record.executorId) {
    throw new Error("reviewerId must differ from executorId");
  }
  return record;
}

function parseMechanism(value: unknown, index: number): Mechanism {
  const record = object(value, `mechanisms[${index}]`);
  onlyKeys(record, ["mechanismKey", "description", "category", "applicable", "appliesWhen", "authorityRef", "risk"], `mechanisms[${index}]`);
  return {
    mechanismKey: id(record.mechanismKey, `mechanisms[${index}].mechanismKey`),
    description: nonempty(record.description, `mechanisms[${index}].description`),
    category: oneOf(record.category, ["happy", "negative", "edge"] as const, `mechanisms[${index}].category`),
    applicable: typeof record.applicable === "boolean" ? record.applicable : (() => { throw new Error(`mechanisms[${index}].applicable must be boolean`); })(),
    appliesWhen: nonempty(record.appliesWhen, `mechanisms[${index}].appliesWhen`),
    authorityRef: nonempty(record.authorityRef, `mechanisms[${index}].authorityRef`),
    risk: oneOf(record.risk, ["low", "medium", "high"] as const, `mechanisms[${index}].risk`),
  };
}

function validateEvent(value: unknown): HumanReviewEvent {
  const record = assertRecordCommon(value);
  if (record.event === "blind_inventory") {
    onlyKeys(record, [...commonKeys, "inventoryId", "journeyKey", "source", "blind", "mechanisms", "notes"], "blind_inventory");
    if (record.blind !== true) throw new Error("blind inventory must set blind=true");
    const mechanisms = Array.isArray(record.mechanisms)
      ? record.mechanisms.map(parseMechanism)
      : (() => { throw new Error("mechanisms must be an array"); })();
    if (new Set(mechanisms.map((item) => item.mechanismKey)).size !== mechanisms.length) {
      throw new Error("blind inventory mechanismKey values must be unique");
    }
    return {
      schemaVersion: 1,
      eventId: record.eventId as string,
      runId: record.runId as string,
      reviewerId: record.reviewerId as string,
      createdAt: record.createdAt as string,
      executorId: record.executorId as string,
      event: "blind_inventory",
      inventoryId: id(record.inventoryId, "inventoryId"),
      journeyKey: id(record.journeyKey, "journeyKey"),
      source: oneOf(record.source, ["human_qa", "pm"] as const, "source"),
      blind: true,
      mechanisms,
      ...(record.notes === undefined ? {} : { notes: nonempty(record.notes, "notes") }),
    } as BlindInventoryEvent;
  }
  if (record.event === "case_review") {
    onlyKeys(record, [...commonKeys, "caseKey", "packetDigest", "category", "applicable", "mechanismKeys",
      "status", "design", "execution", "feedback", "gapCodes", "samplingStrata", "supersedesReviewId"], "case_review");
    const digest = nonempty(record.packetDigest, "packetDigest");
    if (!digestPattern.test(digest)) throw new Error("packetDigest must be a 64-character lowercase SHA-256 digest");
    const mechanismKeys = stringList(record.mechanismKeys, "mechanismKeys", 1);
    const result: CaseReviewEvent = {
      schemaVersion: 1,
      eventId: record.eventId as string,
      runId: record.runId as string,
      reviewerId: record.reviewerId as string,
      createdAt: record.createdAt as string,
      executorId: record.executorId as string,
      event: "case_review",
      caseKey: id(record.caseKey, "caseKey"),
      packetDigest: digest,
      category: oneOf(record.category, ["happy", "negative", "edge"] as const, "category"),
      applicable: record.applicable === true,
      mechanismKeys,
      status: oneOf(record.status, ["accept", "revise", "insufficient"] as const, "status"),
      design: scoreCard(record.design, designAxes, "design"),
      execution: scoreCard(record.execution, executionAxes, "execution"),
      feedback: nonempty(record.feedback, "feedback"),
      gapCodes: stringList(record.gapCodes, "gapCodes"),
      samplingStrata: stringList(record.samplingStrata, "samplingStrata", 1).map((stratum) =>
        oneOf(stratum, ["high_risk", "failure_or_blocked", "disputed_expected", "new_negative_or_edge", "stable_pass_sample"] as const, "samplingStrata")),
      ...(record.supersedesReviewId === undefined ? {} : { supersedesReviewId: id(record.supersedesReviewId, "supersedesReviewId") }),
    };
    return result;
  }
  onlyKeys(record, [...commonKeys, "candidateKey", "decision", "authorityRef", "reason", "supersedesDecisionId"], "pm_decision");
  const result: PmDecisionEvent = {
    schemaVersion: 1,
    eventId: record.eventId as string,
    runId: record.runId as string,
    reviewerId: record.reviewerId as string,
    createdAt: record.createdAt as string,
    executorId: record.executorId as string,
    event: "pm_decision",
    candidateKey: id(record.candidateKey, "candidateKey"),
    decision: oneOf(record.decision, ["promote", "reject", "defer"] as const, "decision"),
    authorityRef: nonempty(record.authorityRef, "authorityRef"),
    reason: nonempty(record.reason, "reason"),
    ...(record.supersedesDecisionId === undefined ? {} : { supersedesDecisionId: id(record.supersedesDecisionId, "supersedesDecisionId") }),
  };
  return result;
}

function sum<T extends readonly ScoreAxis[]>(card: Record<T[number], 0 | 1 | 2>, axes: T): number {
  return axes.reduce((total, axis) => total + Number((card as Record<string, number>)[axis]), 0);
}

function average(values: number[]): number | null {
  return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

export async function reviewLedgerPath(qaRoot: string, ledgerRef: string): Promise<string> {
  if (!ledgerRunId(ledgerRef)) throw new Error(LEDGER_RULE);
  return assertQaRef(await realpath(qaRoot), ledgerRef);
}

export async function appendHumanReview(qaRoot: string, ledgerRef: string, event: HumanReviewInput): Promise<HumanReviewEvent> {
  const ledgerRun = ledgerRunId(ledgerRef);
  if (!ledgerRun) throw new Error(LEDGER_RULE);
  const normalized = validateEvent({ ...event, eventId: event.eventId ?? randomUUID() });
  if (normalized.runId !== ledgerRun) throw new Error("Human review event runId differs from ledger run directory");
  // Validate any existing ancestor before creating this run's ledger directory.
  const parent = await assertQaRef(await realpath(qaRoot), path.posix.dirname(ledgerRef));
  await mkdir(parent, { recursive: true });
  const target = await reviewLedgerPath(qaRoot, ledgerRef);
  const existing = await readHumanReviewLedger(qaRoot, ledgerRef, { allowMissing: true });
  assertNoDuplicateActiveReview(existing, normalized);
  await appendFile(target, `${JSON.stringify(normalized)}\n`, { encoding: "utf8" });
  return normalized;
}

function assertNoDuplicateActiveReview(existing: HumanReviewEvent[], next: HumanReviewEvent): void {
  if (existing.some((item) => item.eventId === next.eventId)) throw new Error(`Duplicate human review eventId: ${next.eventId}`);
  if (next.event === "case_review") {
    const previous = existing.filter((item) => item.event === "case_review" &&
      item.runId === next.runId && item.packetDigest === next.packetDigest && item.caseKey === next.caseKey);
    if (previous.length && next.supersedesReviewId !== previous[previous.length - 1].eventId) {
      throw new Error(`Duplicate active review for ${next.runId}/${next.packetDigest}/${next.caseKey}; supersede the latest review`);
    }
    if (!previous.length && next.supersedesReviewId) {
      throw new Error(`supersedesReviewId does not reference an existing review: ${next.supersedesReviewId}`);
    }
  }
  if (next.event === "blind_inventory" && existing.some((item) => item.runId === next.runId &&
    (item.event === "blind_inventory" || item.event === "case_review"))) {
    throw new Error(`Blind inventory for ${next.runId} must be recorded once before any case review`);
  }
  const latest = [...existing].reverse().find((item) => item.runId === next.runId);
  if (latest && Date.parse(next.createdAt) < Date.parse(latest.createdAt)) {
    throw new Error("Human review event timestamps must be append-monotonic within a run");
  }
}

export async function readHumanReviewLedger(qaRoot: string, ledgerRef: string, options: { allowMissing?: boolean } = {}): Promise<HumanReviewEvent[]> {
  const target = await reviewLedgerPath(qaRoot, ledgerRef);
  const expectedRunId = ledgerRunId(ledgerRef)!;
  let text: string;
  try {
    text = await readFile(target, "utf8");
  } catch (error) {
    if (options.allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: HumanReviewEvent[] = [];
  for (const [index, line] of text.split(/\r?\n/).filter(Boolean).entries()) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`Invalid JSON on human review ledger line ${index + 1}`); }
    const event = validateEvent(value);
    if (event.runId !== expectedRunId) throw new Error(`Human review event runId differs from ledger run directory on line ${index + 1}`);
    assertNoDuplicateActiveReview(events, event);
    events.push(event);
  }
  return events;
}

export async function validateHumanReviewLedger(qaRoot: string, ledgerRef: string): Promise<{ valid: true; events: number }> {
  const events = await readHumanReviewLedger(qaRoot, ledgerRef);
  return { valid: true, events: events.length };
}

export async function summarizeHumanReview(qaRoot: string, ledgerRef: string, runId?: string, packet?: CheckerPacket): Promise<HumanReviewSummary> {
  const events = await readHumanReviewLedger(qaRoot, ledgerRef);
  const selected = runId ? events.filter((event) => event.runId === runId) : events;
  if (!selected.length) throw new Error(runId ? `No human review events for run ${runId}` : "Human review ledger is empty");
  const actualRunId = runId ?? selected[0].runId;
  if (selected.some((event) => event.runId !== actualRunId)) throw new Error("Pass --run-id to summarize a multi-run ledger");
  const frozen = packet ? await verifyCheckerPacket(qaRoot, packet) : undefined;
  if (frozen && frozen.runId !== actualRunId) throw new Error("Human review runId differs from checker packet");
  const inventories = selected.filter((event): event is BlindInventoryEvent => event.event === "blind_inventory");
  const inventory = inventories[0];
  const reviews = selected.filter((event): event is CaseReviewEvent => event.event === "case_review" &&
    (!frozen || event.packetDigest === frozen.digest));
  if (!frozen && new Set(reviews.map((review) => review.packetDigest)).size > 1) {
    throw new Error("Multiple packet digests exist; pass --packet for the current report");
  }
  const latest = new Map<string, CaseReviewEvent>();
  for (const review of reviews) latest.set(`${review.packetDigest}/${review.caseKey}`, review);
  const current = [...latest.values()];
  if (frozen && current.some((review) => !frozen.cases.some((item) => item.caseKey === review.caseKey &&
    item.category === review.category && item.applicable === review.applicable))) {
    throw new Error("Human review Case key/category/applicability differs from checker packet");
  }
  const currentKeys = new Set(current.map((review) => review.caseKey));
  const unreviewed = frozen?.cases.filter((item) => !currentKeys.has(item.caseKey)) ?? [];
  const unreviewedFailureOrNewNegativeEdge = unreviewed.filter((item) =>
    item.status !== "Pass" || (frozen?.mode === "new" && ["negative", "edge"].includes(item.category)));
  const fullPlanReviewed = Boolean(frozen && frozen.cases.length === current.length);
  const applicable = current.filter((review) => review.applicable);
  const designScores = applicable.map((review) => sum(review.design, designAxes));
  const executionScores = applicable.map((review) => sum(review.execution, executionAxes));
  const accepted = applicable.filter((review) => review.status === "accept");
  const designQualified = accepted.filter((review) =>
    sum(review.design, designAxes) >= 8 && designAxes.every((axis) => review.design[axis] > 0));
  const proposedMechanisms = current.flatMap((review) => review.mechanismKeys);
  const reviewedMechanisms = new Set(proposedMechanisms);
  const acceptedMechanisms = new Set(designQualified.flatMap((review) => review.mechanismKeys));
  const applicableInventory = new Set(inventory?.mechanisms.filter((mechanism) => mechanism.applicable).map((mechanism) => mechanism.mechanismKey) ?? []);
  const edgeInventory = new Set(inventory?.mechanisms.filter((mechanism) => mechanism.category === "edge" && mechanism.applicable).map((mechanism) => mechanism.mechanismKey) ?? []);
  const coveredInventory = [...applicableInventory].filter((mechanism) => acceptedMechanisms.has(mechanism)).length;
  const coveredEdge = [...edgeInventory].filter((mechanism) => acceptedMechanisms.has(mechanism)).length;
  const byCategory: Record<CaseCategory, number> = { happy: 0, negative: 0, edge: 0 };
  for (const review of current) byCategory[review.category] += 1;
  const designPassed = designQualified.length;
  const executionPassed = applicable.filter((review) => review.status === "accept" &&
    sum(review.execution, executionAxes) >= 8 && executionAxes.every((axis) => review.execution[axis] > 0)).length;
  const sampleStrata: Record<CaseReviewEvent["samplingStrata"][number], number> = {
    high_risk: 0, failure_or_blocked: 0, disputed_expected: 0, new_negative_or_edge: 0, stable_pass_sample: 0,
  };
  for (const review of current) for (const stratum of review.samplingStrata) sampleStrata[stratum] += 1;
  return {
    runId: actualRunId,
    packetDigests: frozen ? [frozen.digest] : [...new Set(current.map((review) => review.packetDigest))],
    sample: {
      packetCases: frozen?.cases.length ?? null, reviewedCases: current.length,
      coverage: frozen ? ratio(current.length, frozen.cases.length) : null, fullPlanReviewed,
      unreviewedCaseKeys: unreviewed.map((item) => item.caseKey),
      unreviewedFailureOrNewNegativeEdgeKeys: unreviewedFailureOrNewNegativeEdge.map((item) => item.caseKey),
    },
    inventory: {
      available: Boolean(inventory), blind: inventory?.blind === true,
      mechanismCount: inventory?.mechanisms.length ?? 0,
      applicableMechanismCount: applicableInventory.size,
      byCategory: inventory?.mechanisms.reduce((counts, mechanism) => ({ ...counts, [mechanism.category]: counts[mechanism.category] + 1 }), { happy: 0, negative: 0, edge: 0 } as Record<CaseCategory, number>) ?? { happy: 0, negative: 0, edge: 0 },
    },
    cases: {
      reviewed: current.length, applicable: applicable.length, byCategory,
      designAverage: average(designScores), executionAverage: average(executionScores),
      designPassRate: ratio(designPassed, applicable.length), executionPassRate: ratio(executionPassed, applicable.length),
      designAcceptanceRate: ratio(accepted.length, applicable.length),
      mechanismPrecision: ratio(acceptedMechanisms.size, reviewedMechanisms.size),
      mechanismRecall: fullPlanReviewed && inventory ? ratio(coveredInventory, applicableInventory.size) : null,
      edgeMechanismRecall: fullPlanReviewed && inventory ? ratio(coveredEdge, edgeInventory.size) : null,
      sampleStrata,
    },
    noCountGaming: {
      duplicateMechanismsCollapsed: Math.max(0, proposedMechanisms.length - reviewedMechanisms.size),
      duplicateCaseReviewsRejected: 0,
      denominatorLocked: true,
      notes: [
        "Metrics describe reviewed cases only; recall requires every Case in a verified checker packet to have a human review.",
        "Denominators are the latest review for each packetDigest/caseKey and one blind inventory mechanism set.",
        "A case cannot raise recall by adding duplicate mechanismKeys; the ledger rejects duplicate keys.",
        "Promotion of a candidate Expected requires a separate pm_decision event and authorityRef.",
      ],
    },
  };
}
