/**
 * Silent drift: a read-only Action that completes without error but reads the
 * wrong thing — usually a stale locator that matches nothing, so the fact comes
 * back false / 0 / empty. The call succeeded, so nothing falls back to Computer
 * Use, and the empty value would be used as evidence for a verdict.
 *
 * This only flags readings worth one Computer Use screenshot cross-check before
 * they are trusted (e2b:action then logs a pending_crosscheck instead of a hit,
 * settled by `action:reuse confirm`). It never blocks the Action and never
 * judges the product.
 */

export type FactShape = Record<string, "filled" | "empty">;

/**
 * `sentinel`: the reading carried a value the Action returns only when it did not
 * recognize the page (declared in the row's driftSentinels). That is the Action
 * reporting its own drift, so health is marked suspected_drift at once.
 */
export type SilentDriftCheck = { crossCheck: boolean; reasons: string[]; sentinel?: boolean };

/** Prefix of a cross-check reason produced by a drift sentinel (kept in the settled crossCheck.reasons). */
export const SENTINEL_REASON_PREFIX = "[sentinel] ";

export function isSentinelReason(reason: string): boolean {
  return reason.startsWith(SENTINEL_REASON_PREFIX);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** Which fields of a fact carried a value. One nested level is flattened as `parent.child`. */
export function factShape(fact: unknown): FactShape {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) return {};
  const shape: FactShape = {};
  for (const [key, value] of Object.entries(fact as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
      for (const [child, nested] of Object.entries(value as Record<string, unknown>)) {
        shape[`${key}.${child}`] = isEmpty(nested) ? "empty" : "filled";
      }
    } else {
      shape[key] = isEmpty(value) ? "empty" : "filled";
    }
  }
  return shape;
}

/** Flattened field values (same paths as factShape: one nested level as `parent.child`). */
export function factValues(fact: unknown): Record<string, unknown> {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) return {};
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fact as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
      for (const [child, nested] of Object.entries(value as Record<string, unknown>)) values[`${key}.${child}`] = nested;
    } else {
      values[key] = value;
    }
  }
  return values;
}

/**
 * What a correct reading of an observation (rollback=read) Action looks like,
 * declared on its Action table row (action-catalog.json):
 * - mustHaveValue: fields that always carry a value when the page is read
 *   correctly (flattened like factShape, e.g. `readiness.summary`);
 * - allowedValues: the legal values of an enumerated field (e.g. cardState);
 *   null/absent values are left to mustHaveValue.
 */
export type ReadExpectations = {
  mustHaveValue?: readonly string[];
  allowedValues?: Readonly<Record<string, readonly string[]>>;
  /**
   * Values a field takes only when the Action did not recognize the page
   * (e.g. cardState "unrecognized"): an explicit unknown-shape sentinel.
   */
  driftSentinels?: Readonly<Record<string, readonly string[]>>;
};

/**
 * Flags a reading for one Computer Use screenshot cross-check when every field
 * is empty, a mustHaveValue field is empty, or an enumerated field reads a value
 * outside allowedValues (e.g. `unrecognized`). It never compares with earlier
 * readings: an empty list or a zero can be the true answer.
 */
export function checkSilentDrift(fact: unknown, expectations: ReadExpectations = {}): SilentDriftCheck {
  const shape = factShape(fact);
  const keys = Object.keys(shape);
  if (keys.length === 0) return { crossCheck: false, reasons: [] };
  if (keys.every((key) => shape[key] === "empty")) {
    return { crossCheck: true, reasons: [`全部读数为空（${keys.join(", ")}）`] };
  }
  const values = factValues(fact);
  const reasons: string[] = [];
  const sentinelFields = new Set<string>();
  for (const [field, sentinels] of Object.entries(expectations.driftSentinels ?? {})) {
    const value = values[field];
    if (value === null || value === undefined || typeof value === "object") continue;
    if (sentinels.includes(String(value))) {
      sentinelFields.add(field);
      reasons.push(`${SENTINEL_REASON_PREFIX}${field} 读到 ${String(value)}：Action 没认出页面（疑似静默失效）`);
    }
  }
  for (const field of expectations.mustHaveValue ?? []) {
    if (shape[field] !== "filled") reasons.push(`${field} 应有值，这次为空`);
  }
  for (const [field, allowed] of Object.entries(expectations.allowedValues ?? {})) {
    if (sentinelFields.has(field)) continue;
    const value = values[field];
    if (value === null || value === undefined || typeof value === "object") continue;
    if (!allowed.includes(String(value))) {
      reasons.push(`${field} 取值 ${String(value)} 不在合法取值内（${allowed.join(", ")}）`);
    }
  }
  return sentinelFields.size
    ? { crossCheck: true, reasons, sentinel: true }
    : { crossCheck: reasons.length > 0, reasons };
}

/**
 * The health transition an e2b:action invocation earns:
 * - completed and trusted → "completed" (verifies the Action, sets lastUsed);
 * - completed with a drift sentinel → "sentinel_drift" (suspected_drift now; the reading is not a hit);
 * - completed but waiting for a cross-check → null (action:reuse confirm settles it);
 * - failed with a drift-suspected classification → "drift"; any other failure → null.
 */
export function invocationHealthKind(input: {
  status: string; driftSuspected: boolean; silentDrift: SilentDriftCheck;
}): "completed" | "drift" | "sentinel_drift" | null {
  if (input.status === "completed") {
    if (input.silentDrift.sentinel) return "sentinel_drift";
    return input.silentDrift.crossCheck ? null : "completed";
  }
  return input.driftSuspected ? "drift" : null;
}
