import type { ActionEntry } from "./action-index";
import {
  loadActionTable,
  normalizeIntent,
  validateActionTable,
  type ActionTable,
  type ActionTableEntry,
  type RollbackLevel,
} from "./action-table";
import { sharedActionDenial } from "./shared-action-policy";

export type { ActionVerification, RollbackLevel } from "./action-table";

/** One row of the Action table (action-catalog.json). */
export type ActionCatalogEntry = ActionTableEntry;

export type ActionSelector = {
  intent?: string;
  domain?: string;
  surface?: string;
  role?: string;
  page?: string;
  state?: string;
  requiredFacts?: string[];
  /** Keep only Actions at or below this rollback level. A search filter, not a permission. */
  rollbackAllowed?: RollbackLevel;
  /** Keep only Actions that may run in a shared E2B browser, i.e. that the denylist does not block. */
  sharedExecution?: boolean;
  strictContext?: boolean;
  limit?: number;
};

export type ActionCandidate = {
  action: ActionEntry;
  metadata: Partial<ActionCatalogEntry>;
  eligible: boolean;
  /** The query is exactly this Action's intent or one of its aliases. */
  exact: boolean;
  score: number;
  matched: string[];
  unknown: string[];
  missingFacts: string[];
};

const rollbackRank: Record<RollbackLevel, number> = { read: 0, reversible: 1, irreversible: 2 };

function words(text: string): string[] {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .split(/[^a-z0-9]+/).filter((word) => word.length > 1);
}

function includesValue(values: string[] | undefined, value: string | undefined): "yes" | "no" | "unknown" {
  if (!value) return "yes";
  if (!values?.length) return "unknown";
  return values.includes(value) ? "yes" : "no";
}

/** The texts an intent query is matched against: the Action name, its table intent and aliases. */
export function intentTexts(name: string, metadata: Partial<ActionCatalogEntry> | undefined): string[] {
  return [name, ...(metadata?.intent ? [metadata.intent] : []), ...(metadata?.aliases ?? [])];
}

function textMatches(entry: ActionEntry, metadata: Partial<ActionCatalogEntry>, intent: string): string[] {
  const raw = intent.trim().toLowerCase();
  if (!raw) return [];
  const matched = new Set<string>();
  for (const text of intentTexts(entry.name, metadata)) {
    const lower = text.toLowerCase();
    if (lower.includes(raw)) matched.add(text);
    const queryWords = words(raw);
    const textWords = new Set(words(text));
    if (queryWords.length && queryWords.every((word) => textWords.has(word))) matched.add(text);
  }
  return [...matched];
}

/** The Action table must have exactly one well-formed row per exported Action. */
export function validateActionCatalog(
  entries: readonly ActionEntry[],
  catalog: Readonly<Record<string, ActionCatalogEntry>>,
): void {
  validateActionTable(entries, catalog, sharedActionDenial);
}

export function selectActions(
  entries: readonly ActionEntry[],
  catalog: Readonly<Record<string, Partial<ActionCatalogEntry>>>,
  selector: ActionSelector,
): ActionCandidate[] {
  const limit = selector.limit === undefined ? 12 : selector.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Action select limit must be 1..100");
  const wanted = selector.intent ? normalizeIntent(selector.intent) : "";
  const candidates: ActionCandidate[] = [];
  for (const action of entries) {
    const metadata = catalog[action.name] ?? {};
    if (selector.domain && action.domain !== selector.domain) continue;
    if (selector.sharedExecution === true && sharedActionDenial(action.name)) continue;
    if (selector.rollbackAllowed && (!metadata.rollback ||
        rollbackRank[metadata.rollback] > rollbackRank[selector.rollbackAllowed])) continue;
    const dimensions: Array<[string, string[] | undefined, string | undefined]> = [
      ["surface", metadata.surfaces, selector.surface],
      ["role", metadata.roles, selector.role],
      ["page", metadata.pages, selector.page],
      ["state", metadata.states, selector.state],
    ];
    let rejected = false;
    const unknown: string[] = [];
    for (const [name, values, wanted] of dimensions) {
      const match = includesValue(values, wanted);
      if (match === "no") rejected = true;
      if (match === "unknown" && wanted) unknown.push(name);
    }
    if (rejected || (selector.strictContext && unknown.length)) continue;
    const missingFacts = (selector.requiredFacts ?? []).filter((fact) => !metadata.providedFacts?.includes(fact));
    const matched = selector.intent ? textMatches(action, metadata, selector.intent) : [];
    if (selector.intent && !matched.length) continue;
    const exact = Boolean(wanted) && [metadata.intent, ...(metadata.aliases ?? [])]
      .some((text) => text !== undefined && normalizeIntent(text) === wanted);
    const score = Number(exact) * 100 + matched.length * 20 + Number(action.hot) * 5 +
      Number(metadata.verification === "reviewed") * 3 - unknown.length * 2 - missingFacts.length;
    candidates.push({ action, metadata, eligible: !unknown.length && !missingFacts.length,
      exact, score, matched, unknown, missingFacts });
  }
  return candidates.sort((a, b) => Number(b.eligible) - Number(a.eligible) ||
    b.score - a.score || a.action.name.localeCompare(b.action.name)).slice(0, limit);
}

export async function loadActionCatalog(root: string): Promise<ActionTable> {
  return loadActionTable(root);
}
