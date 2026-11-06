import { readFileSync } from "node:fs";
import path from "node:path";

import type { ActionEntry } from "./action-index";

/**
 * The Action table (`action-catalog.json`) has one row per exported library
 * Action. It describes; it does not gate. A row says what business end point
 * the Action reaches (`intent`), how far its effect can be taken back
 * (`rollback`) and, when it can, which Action takes it back (`undoneBy`).
 *
 * - read: changes no product data (opening a dialog or a picker, expanding a
 *   panel, typing into an unsaved field all count as read). A read Action that
 *   leaves the app origin is a failure.
 * - reversible: changes product state that another call can put back.
 * - irreversible: changes state no library Action puts back (launch, approve,
 *   cancel, remove, spend, generate, send). If it fails or times out the
 *   outcome is unknown: check read-only, never re-send blindly.
 *
 * Whether an Action may run in a shared E2B browser is decided only by the
 * denylist in shared-action-policy.ts; a denied Action keeps its row and says
 * why in `denied`.
 */
export const ROLLBACK_LEVELS = ["read", "reversible", "irreversible"] as const;
export type RollbackLevel = (typeof ROLLBACK_LEVELS)[number];
export type ActionVerification = "candidate" | "reviewed";

export type ActionTableEntry = {
  /** Business end point, Chinese first, e.g. "把草稿切到 Traffic". Unique across the table. */
  intent: string;
  /** Other phrasings (often English) that mean the same end point. Unique across the table. */
  aliases?: string[];
  rollback: RollbackLevel;
  /** The Action that takes a reversible effect back; null when none exists (then undoNote says why). */
  undoneBy?: string | null;
  undoNote?: string;
  /** Exact argument count after page; when absent, the function's formal parameters bound it. */
  args?: number;
  /** Why the shared-execution denylist blocks it. Present exactly for denied Actions. */
  denied?: string;
  surfaces?: string[];
  roles?: string[];
  pages?: string[];
  states?: string[];
  requiredFacts?: string[];
  providedFacts?: string[];
  preconditions?: string[];
  inputs?: string[];
  verification?: ActionVerification;
  /**
   * Observation (rollback=read) rows only: fact fields that always carry a value when the
   * page is read correctly, flattened like factShape (`parent.child`). An empty one makes
   * e2b:action ask for a Computer Use cross-check before the reading counts.
   */
  mustHaveValue?: string[];
  /** Observation rows only: legal values of enumerated fact fields (e.g. cardState); another value asks for a cross-check. */
  allowedValues?: Record<string, string[]>;
  /**
   * Observation rows only: values a fact field takes only when the Action did not recognize
   * the page (e.g. cardState "unrecognized"). Such a reading is not a hit: e2b:action logs it
   * pending_crosscheck and marks the Action's health suspected_drift at once.
   */
  driftSentinels?: Record<string, string[]>;
  /** Kept by action:prune even when stale or unhealthy. */
  pinned?: boolean;
};

export type ActionTable = Record<string, ActionTableEntry>;

const TABLE_FILE = "src/tools/action-catalog.json";
const defaultRoot = path.resolve(import.meta.dirname, "../..");
const cache = new Map<string, ActionTable>();

export function loadActionTable(root = defaultRoot): ActionTable {
  const file = path.join(root, TABLE_FILE);
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(file, "utf8")) as ActionTable);
  return cache.get(file)!;
}

export function actionTableEntry(name: string, root = defaultRoot): ActionTableEntry | undefined {
  const table = loadActionTable(root);
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

/** Case, width and spacing do not make two intents different. */
export function normalizeIntent(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

/** The single Action whose intent or alias is exactly this text, or undefined. */
export function resolveIntent(table: Readonly<ActionTable>, text: string): string | undefined {
  const wanted = normalizeIntent(text);
  if (!wanted) return undefined;
  for (const [name, row] of Object.entries(table)) {
    if ([row.intent, ...(row.aliases ?? [])].some((candidate) => normalizeIntent(candidate) === wanted)) return name;
  }
  return undefined;
}

/**
 * Maps the retired caller-supplied levels onto rollback levels, so facts and
 * docs written before the table still read: side_effect and
 * irreversible_high_impact are both irreversible.
 */
export function legacyRollback(level: string): RollbackLevel {
  switch (level) {
    case "read": return "read";
    case "reversible": return "reversible";
    case "irreversible":
    case "side_effect":
    case "irreversible_high_impact": return "irreversible";
    default: throw new Error(`Unknown side-effect level ${level}: no rollback level for it`);
  }
}

const LIST_FIELDS = ["aliases", "surfaces", "roles", "pages", "states", "requiredFacts", "providedFacts", "preconditions", "inputs"] as const;
const KNOWN_FIELDS = new Set<string>(["intent", "rollback", "undoneBy", "undoNote", "args", "denied", "verification",
  "mustHaveValue", "allowedValues", "driftSentinels", "pinned", ...LIST_FIELDS]);
const FIELD_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/;

function validateDriftSentinels(name: string, row: ActionTableEntry): void {
  const sentinels = row.driftSentinels;
  if (sentinels === undefined) return;
  if (row.rollback !== "read") {
    throw new Error(`Action table ${name}: driftSentinels belong on only an observation (rollback=read) row`);
  }
  if (!sentinels || typeof sentinels !== "object" || Array.isArray(sentinels) || !Object.keys(sentinels).length) {
    throw new Error(`Action table ${name} has invalid driftSentinels: an object of field path -> sentinel values`);
  }
  for (const [field, values] of Object.entries(sentinels)) {
    if (!FIELD_PATH.test(field) || !Array.isArray(values) || !values.length ||
        values.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error(`Action table ${name} has invalid driftSentinels.${field}: a nonempty list of strings`);
    }
    const allowed = row.allowedValues?.[field] ?? [];
    const clash = values.find((value) => allowed.includes(value));
    if (clash !== undefined) {
      throw new Error(`Action table ${name} has driftSentinels.${field} value ${clash} that allowedValues also allows`);
    }
  }
}

function validateReadExpectations(name: string, row: ActionTableEntry): void {
  validateDriftSentinels(name, row);
  if (row.mustHaveValue === undefined && row.allowedValues === undefined) return;
  if (row.rollback !== "read") {
    throw new Error(`Action table ${name}: mustHaveValue/allowedValues belong on only an observation (rollback=read) row`);
  }
  const fields = row.mustHaveValue;
  if (fields !== undefined && (!Array.isArray(fields) || !fields.length ||
      fields.some((field) => typeof field !== "string" || !FIELD_PATH.test(field)) || new Set(fields).size !== fields.length)) {
    throw new Error(`Action table ${name} has invalid mustHaveValue: a nonempty list of distinct fact field paths (field or parent.child)`);
  }
  const allowed = row.allowedValues;
  if (allowed !== undefined) {
    if (!allowed || typeof allowed !== "object" || Array.isArray(allowed) || !Object.keys(allowed).length) {
      throw new Error(`Action table ${name} has invalid allowedValues: an object of field path -> legal values`);
    }
    for (const [field, values] of Object.entries(allowed)) {
      if (!FIELD_PATH.test(field) || !Array.isArray(values) || !values.length ||
          values.some((value) => typeof value !== "string" || !value.trim())) {
        throw new Error(`Action table ${name} has invalid allowedValues.${field}: a nonempty list of strings`);
      }
    }
  }
}

/**
 * Throws unless the table has exactly one well-formed row per exported Action:
 * an intent and rollback level on every row, no intent or alias shared by two
 * Actions, every undoneBy naming a real Action, and `denied` present exactly
 * for the Actions the denylist blocks.
 */
export function validateActionTable(
  entries: readonly ActionEntry[],
  table: Readonly<ActionTable>,
  denial: (name: string) => string | undefined,
): void {
  const indexed = new Set(entries.map((entry) => entry.name));
  if (indexed.size !== entries.length) throw new Error("Action exports must have unique names");
  for (const name of indexed) {
    if (!Object.hasOwn(table, name)) {
      throw new Error(`Action ${name} has no row in the Action table (src/tools/action-catalog.json): add intent, rollback and undoneBy`);
    }
  }
  const owners = new Map<string, string>();
  for (const [name, row] of Object.entries(table)) {
    if (!indexed.has(name)) throw new Error(`Action table row ${name} has no exported Action`);
    if (!row || typeof row !== "object") throw new Error(`Action table row ${name} must be an object`);
    if (Object.hasOwn(row, "sharedExecution")) {
      throw new Error(`Action table ${name} has retired field sharedExecution; shared execution is denylist-based`);
    }
    if (Object.hasOwn(row, "sideEffect")) {
      throw new Error(`Action table ${name} has retired field sideEffect; write rollback (read | reversible | irreversible)`);
    }
    for (const field of Object.keys(row)) {
      if (!KNOWN_FIELDS.has(field)) throw new Error(`Action table ${name} has unknown field ${field}`);
    }
    if (typeof row.intent !== "string" || !row.intent.trim() || row.intent.length > 160) {
      throw new Error(`Action table ${name} needs an intent of 1 to 160 characters`);
    }
    if (!(ROLLBACK_LEVELS as readonly string[]).includes(row.rollback)) {
      throw new Error(`Action table ${name} has invalid rollback ${String(row.rollback)}; use read | reversible | irreversible`);
    }
    for (const field of LIST_FIELDS) {
      const values = row[field];
      if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim()))) {
        throw new Error(`Action table ${name} has invalid ${field}`);
      }
    }
    for (const text of [row.intent, ...(row.aliases ?? [])]) {
      const key = normalizeIntent(text);
      const owner = owners.get(key);
      if (owner !== undefined && owner !== name) {
        throw new Error(`Action table intent "${text}" is used by ${owner} and ${name}; one intent maps to one Action`);
      }
      owners.set(key, name);
    }
    if (row.undoneBy !== undefined && row.undoneBy !== null &&
        (typeof row.undoneBy !== "string" || !indexed.has(row.undoneBy))) {
      throw new Error(`Action table ${name} has undoneBy ${String(row.undoneBy)}, which is not an exported Action`);
    }
    if (row.rollback === "reversible") {
      if (!Object.hasOwn(row, "undoneBy")) {
        throw new Error(`Action table ${name} is reversible: set undoneBy to the Action that undoes it, or null with an undoNote`);
      }
      if (row.undoneBy === null && (typeof row.undoNote !== "string" || !row.undoNote.trim())) {
        throw new Error(`Action table ${name} has undoneBy null: undoNote must say how it is undone`);
      }
    } else if (row.undoneBy) {
      throw new Error(`Action table ${name} is ${row.rollback}; only a reversible Action names undoneBy`);
    }
    if (row.undoNote !== undefined && (typeof row.undoNote !== "string" || !row.undoNote.trim())) {
      throw new Error(`Action table ${name} has an empty undoNote`);
    }
    if (row.args !== undefined && (!Number.isInteger(row.args) || row.args < 0 || row.args > 10)) {
      throw new Error(`Action table ${name} has invalid args`);
    }
    const deniedReason = denial(name);
    if (deniedReason && (typeof row.denied !== "string" || !row.denied.trim())) {
      throw new Error(`Action table ${name} is on the shared-execution denylist: its row must say why in denied`);
    }
    if (!deniedReason && row.denied !== undefined) {
      throw new Error(`Action table ${name} says denied, but the shared-execution denylist does not block it`);
    }
    if (row.verification !== undefined && row.verification !== "candidate" && row.verification !== "reviewed") {
      throw new Error(`Action table ${name} has invalid verification`);
    }
    if (row.pinned !== undefined && typeof row.pinned !== "boolean") {
      throw new Error(`Action table ${name} has invalid pinned: true or false`);
    }
    validateReadExpectations(name, row);
  }
}
