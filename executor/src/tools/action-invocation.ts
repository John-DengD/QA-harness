import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROLLBACK_LEVELS, legacyRollback, type RollbackLevel } from "./action-table";

export const actionInvocationKind = "action-invocation" as const;
/**
 * Version 2 records the Action table's rollback level (and undoneBy, intent).
 * Version 1 facts recorded the caller's --side-effect instead; they still
 * validate, with side_effect read as irreversible, so old run directories stay
 * readable.
 */
export const actionInvocationSchemaVersion = 2 as const;
export const ACTION_INVOCATION_SCHEMA_VERSIONS = [1, 2] as const;

export type ActionInvocationStatus = "completed" | "failed" | "action_unknown";

export type ActionInvocationFact = {
  kind: typeof actionInvocationKind;
  schemaVersion: (typeof ACTION_INVOCATION_SCHEMA_VERSIONS)[number];
  invocationId: string;
  runId: string;
  caseId: string;
  intentId: string;
  action: string;
  domain: string;
  sandboxId: string;
  origin: string;
  /** From the Action table (v2) or mapped from the v1 sideEffect. */
  rollback: RollbackLevel;
  /** The table's undo Action for a reversible Action; null otherwise and for v1 facts. */
  undoneBy: string | null;
  /** The table intent the Action serves; null for v1 facts. */
  intent: string | null;
  status: ActionInvocationStatus;
  startedAt: string;
  finishedAt: string;
  lookupMs: number;
  executionMs: number;
  factPath: string;
  beforeScreenshot: string;
  afterScreenshot: string | null;
  target: {
    origin: string;
    beforeScreenshot: string;
    afterScreenshot: string | null;
  };
  fact: unknown;
  error: string | null;
  integrityHash: string;
};

export type ActionHitBinding = {
  runId: string;
  caseId: string;
  intentId: string;
  action: string;
  invocationId: string;
  factRef: string;
  factSha256: string;
  lookupMs: number;
  executionMs: number;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 400) {
    throw new Error(`${label} must be a nonempty short string`);
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) throw new Error(`${label} must be non-negative`);
  return Number(value);
}

function timestamp(value: unknown, label: string): string {
  const text = nonempty(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO timestamp`);
  return text;
}

function uuid(value: unknown, label: string): string {
  const text = nonempty(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} must be a UUID`);
  }
  return text;
}

/** Stable JSON used for the local integrity marker. It is not a cryptographic signature. */
export function canonicalInvocationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInvocationJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalInvocationJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function integrityBody(fact: Record<string, unknown>): Record<string, unknown> {
  const { integrityHash: _integrityHash, ...body } = fact;
  return body;
}

function invocationRollback(
  fact: Record<string, unknown>,
  schemaVersion: ActionInvocationFact["schemaVersion"]
): Pick<ActionInvocationFact, "rollback" | "undoneBy" | "intent"> {
  if (schemaVersion === 1) {
    if (fact.sideEffect !== "read" && fact.sideEffect !== "reversible" && fact.sideEffect !== "side_effect") {
      throw new Error("Invalid Action invocation sideEffect");
    }
    return { rollback: legacyRollback(fact.sideEffect), undoneBy: null, intent: null };
  }
  if (!(ROLLBACK_LEVELS as readonly unknown[]).includes(fact.rollback) || Object.hasOwn(fact, "sideEffect")) {
    throw new Error("Invalid Action invocation rollback: expected read, reversible or irreversible from the Action table");
  }
  return {
    rollback: fact.rollback as RollbackLevel,
    undoneBy: fact.undoneBy === undefined || fact.undoneBy === null ? null : nonempty(fact.undoneBy, "undoneBy"),
    intent: fact.intent === undefined || fact.intent === null ? null : nonempty(fact.intent, "intent"),
  };
}

export function validateActionInvocationFact(value: unknown): ActionInvocationFact {
  const fact = object(value, "Action invocation fact");
  if (fact.kind !== actionInvocationKind ||
      !(ACTION_INVOCATION_SCHEMA_VERSIONS as readonly unknown[]).includes(fact.schemaVersion)) {
    throw new Error("Unsupported Action invocation fact");
  }
  const schemaVersion = fact.schemaVersion as ActionInvocationFact["schemaVersion"];
  const target = object(fact.target, "Action invocation target");
  const normalized: Omit<ActionInvocationFact, "integrityHash"> = {
    kind: actionInvocationKind,
    schemaVersion,
    invocationId: uuid(fact.invocationId, "invocationId"),
    runId: nonempty(fact.runId, "runId"),
    caseId: nonempty(fact.caseId, "caseId"),
    intentId: nonempty(fact.intentId, "intentId"),
    action: nonempty(fact.action, "action"),
    domain: nonempty(fact.domain, "domain"),
    sandboxId: nonempty(fact.sandboxId, "sandboxId"),
    origin: nonempty(fact.origin, "origin"),
    ...invocationRollback(fact, schemaVersion),
    status: fact.status === "completed" || fact.status === "failed" || fact.status === "action_unknown"
      ? fact.status : (() => { throw new Error("Invalid Action invocation status"); })(),
    startedAt: timestamp(fact.startedAt, "startedAt"),
    finishedAt: timestamp(fact.finishedAt, "finishedAt"),
    lookupMs: finite(fact.lookupMs, "lookupMs"),
    executionMs: finite(fact.executionMs, "executionMs"),
    factPath: nonempty(fact.factPath, "factPath"),
    beforeScreenshot: nonempty(fact.beforeScreenshot, "beforeScreenshot"),
    afterScreenshot: fact.afterScreenshot === null ? null : nonempty(fact.afterScreenshot, "afterScreenshot"),
    target: {
      origin: nonempty(target.origin, "target.origin"),
      beforeScreenshot: nonempty(target.beforeScreenshot, "target.beforeScreenshot"),
      afterScreenshot: target.afterScreenshot === null ? null : nonempty(target.afterScreenshot, "target.afterScreenshot"),
    },
    fact: fact.fact,
    error: fact.error === null ? null : nonempty(fact.error, "error"),
  };
  const integrityHash = nonempty(fact.integrityHash, "integrityHash");
  if (!/^[a-f0-9]{64}$/.test(integrityHash) ||
      sha256Bytes(canonicalInvocationJson(integrityBody(fact))) !== integrityHash) {
    throw new Error("Action invocation integrity hash mismatch");
  }
  if (Date.parse(normalized.finishedAt) < Date.parse(normalized.startedAt) ||
      (normalized.status === "completed" && (normalized.error !== null || normalized.afterScreenshot === null))) {
    throw new Error("Action invocation completion and evidence are inconsistent");
  }
  if (normalized.factPath !== `playwright/actions/${normalized.invocationId}.json` ||
      normalized.beforeScreenshot !== `${normalized.invocationId}-before.png` ||
      normalized.target.beforeScreenshot !== `playwright/actions/${normalized.beforeScreenshot}` ||
      normalized.target.origin !== normalized.origin ||
      (normalized.afterScreenshot !== null &&
        (normalized.afterScreenshot !== `${normalized.invocationId}-after.png` ||
         normalized.target.afterScreenshot !== `playwright/actions/${normalized.afterScreenshot}`)) ||
      (normalized.afterScreenshot === null && normalized.target.afterScreenshot !== null)) {
    throw new Error("Action invocation target evidence does not match its ID");
  }
  return { ...normalized, integrityHash };
}

export function assertActionHitBinding(fact: ActionInvocationFact, binding: ActionHitBinding): void {
  if (fact.status !== "completed") throw new Error("Action hit needs a completed invocation fact");
  if (fact.runId !== binding.runId || fact.caseId !== binding.caseId || fact.intentId !== binding.intentId ||
      fact.action !== binding.action || fact.invocationId !== binding.invocationId ||
      fact.lookupMs !== binding.lookupMs || fact.executionMs !== binding.executionMs) {
    throw new Error("Action invocation fact is not tied to the reuse event");
  }
}

export async function readActionInvocationFact(file: string, binding: ActionHitBinding): Promise<{
  fact: ActionInvocationFact;
  sha256: string;
}> {
  const bytes = await readFile(file);
  const sha256 = sha256Bytes(bytes);
  if (sha256 !== binding.factSha256) throw new Error("Action invocation fact hash does not match the reuse event");
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Action invocation fact is not valid JSON"); }
  const fact = validateActionInvocationFact(parsed);
  if (path.basename(file) !== `${fact.invocationId}.json` || path.basename(path.dirname(file)) !== "actions") {
    throw new Error("Action invocation fact path does not match its ID");
  }
  assertActionHitBinding(fact, binding);
  return { fact, sha256 };
}
