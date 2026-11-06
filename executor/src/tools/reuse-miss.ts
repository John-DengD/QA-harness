import { validateReuseEvent, type ActionEntry, type ReuseEvent } from "./action-index";
import { intentTexts, selectActions, type ActionCatalogEntry } from "./action-select";
import { noticeFor, type ActionHealthView } from "./action-health";
import { sharedActionDenial } from "./shared-action-policy";

/**
 * Why an intent that was worth reusing ran without an Action. Shared E2B
 * execution is default-allow, so a library Action that is not denied could
 * have run.
 *
 * - absent: the library has nothing for it.
 * - not_found: the library has a runnable Action for it, lookup missed it.
 * - denied: the library has it, but the shared-execution denylist blocks it.
 * - precondition / drift: an Action exists but did not apply here / no longer matches the product.
 */
export const REUSE_MISS_REASONS = [
  "absent",
  "not_found",
  "denied",
  "precondition",
  "drift",
  "unsafe",
  "novel",
  "other",
] as const;

export type ReuseMissReason = (typeof REUSE_MISS_REASONS)[number];

/**
 * Retired reasons: old logs that carry them still parse and summarize
 * (validateReuseEvent accepts them), but a new miss may not use them.
 * `not_allowlisted` meant "not on the shared allowlist", which no longer exists.
 */
export const LEGACY_REUSE_MISS_REASONS = ["not_allowlisted"] as const;

/** Reasons that point at a specific library Action and therefore must name it. */
const NAMES_ACTION: ReadonlySet<ReuseMissReason> = new Set(["not_found", "denied", "drift"]);

/**
 * Tab, reload, scroll and native-browser-dialog mechanics are how a step is
 * carried out, not a business end point. Logging them as intents inflates the
 * miss count with things no product Action should ever cover. Returns the kind
 * of primitive, or null for a business intent.
 *
 * The patterns only match tab *management* (open a blank tab, switch/close/
 * return to a tab), page reloads, scrolling, and native browser dialogs, so
 * business intents that happen to mention a tab ("open tracking setup") or a
 * product dialog ("open the Switch to Traffic dialog") are left alone.
 */
export function browserPrimitiveIntent(intentId: string, intent: string): string | null {
  const ids = intentId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const text = intent.toLowerCase();
  if (ids.some((word) => ["tab", "tabs", "newtab"].includes(word)) ||
      /\b(?:new|blank|switch(?:ing)? (?:to )?(?:the )?|close|return to|back to)\s*(?:\w+\s){0,3}tab\b/.test(text) ||
      /(?:切到|切回|切换到?|关闭|关掉|新开|离开|回到|返回)[^，。,;；()（）]{0,14}标签/.test(intent)) {
    return "tab";
  }
  if (ids.some((word) => ["reload", "refresh"].includes(word)) &&
      !/retry|readiness|check|重试|检查/i.test(intent) ||
      /刷新页面|重新加载页面|\breload (?:the )?page\b|\brefresh (?:the )?page\b|\bf5\b/.test(text)) {
    return "reload";
  }
  if (ids.includes("scroll") || /\bscroll(?:ing)?\b|滚动|下拉页面/.test(text)) return "scroll";
  if (/浏览器弹窗|原生弹窗|browser (?:dialog|popup|alert|prompt)|native (?:dialog|alert)/.test(text)) {
    return "browser-dialog";
  }
  return null;
}

const STOP = new Set([
  "a", "an", "the", "to", "of", "on", "in", "for", "and", "or", "from", "with", "at", "by", "into",
  "page", "click", "tap", "press", "button", "step", "case", "go", "via", "it", "its",
]);

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function intentWords(text: string): string[] {
  return [...new Set(text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word) && !/^c\d+$/.test(word) && !/^\d+$/.test(word))
    .map(stem))];
}

export type MissCandidate = {
  name: string;
  domain: string;
  /** True when the shared-execution denylist blocks it; any other candidate could have run. */
  denied: boolean;
  matchedBy: string[];
};

/**
 * Library Actions that plausibly serve an intent, found three ways: the
 * structured `action:select` match on the intent text (against each table
 * row's intent and aliases), a verbatim CJK table intent or alias inside the
 * intent text, and word overlap between the intent words (the ID alone when it
 * has two or more words, and ID plus text together) and an Action's name,
 * domain, table intent and aliases. Word overlap needs half the words and at
 * least one word that few Actions share, so "open campaign forecast" does not
 * match every open-campaign Action.
 */
export function findMissCandidates(
  entries: readonly ActionEntry[],
  catalog: Readonly<Record<string, ActionCatalogEntry>>,
  intentId: string,
  intent: string,
): MissCandidate[] {
  const found = new Map<string, Set<string>>();
  const add = (name: string, by: string) => {
    if (!found.has(name)) found.set(name, new Set());
    found.get(name)!.add(by);
  };
  for (const candidate of selectActions(entries, catalog, { intent, limit: 100 })) {
    add(candidate.action.name, "action-select");
  }
  const compact = intent.replace(/\s+/g, "").toLowerCase();
  for (const action of entries) {
    for (const alias of intentTexts(action.name, catalog[action.name]).slice(1)) {
      const aliasCompact = alias.replace(/\s+/g, "").toLowerCase();
      if (/[㐀-鿿]/.test(alias) && aliasCompact.length >= 4 && compact.includes(aliasCompact)) {
        add(action.name, "alias");
      }
    }
  }
  const vocab = new Map(entries.map((action) => [action.name, new Set(intentWords(
    [...intentTexts(action.name, catalog[action.name]), action.domain].join(" ")))]));
  const documentFrequency = new Map<string, number>();
  for (const words of vocab.values()) {
    for (const word of words) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  }
  const distinctiveLimit = Math.max(1, Math.floor(entries.length * 0.1));
  // A one-word intent ID ("c4-confirm") is too terse to search on alone; it is
  // only searched together with the intent text.
  const idWords = intentWords(intentId);
  const queries = [idWords.length >= 2 ? idWords : [], [...new Set([...idWords, ...intentWords(intent)])]];
  for (const query of queries) {
    if (!query.length) continue;
    for (const action of entries) {
      const words = vocab.get(action.name)!;
      const matched = query.filter((word) => words.has(word));
      if (matched.length >= Math.min(2, query.length) && matched.length / query.length >= 0.5 &&
          matched.some((word) => (documentFrequency.get(word) ?? 0) <= distinctiveLimit)) {
        add(action.name, `words:${matched.join("+")}`);
      }
    }
  }
  const byName = new Map(entries.map((action) => [action.name, action]));
  return [...found.entries()].map(([name, by]) => ({
    name,
    domain: byName.get(name)!.domain,
    denied: Boolean(sharedActionDenial(name)),
    matchedBy: [...by],
  })).sort((a, b) => b.matchedBy.length - a.matchedBy.length || a.name.localeCompare(b.name));
}

export type ReuseMissInput = {
  runId: string;
  caseId: string;
  intentId: string;
  intent: string;
  source: "computer-use" | "playwright-explore";
  reason?: string;
  /** The library Action the reason refers to (required for not_found/denied/drift). */
  action?: string;
  /** Candidates the operator opened and judged inapplicable before insisting on absent. */
  reviewedCandidates?: readonly string[];
  executionMs: number;
  lookupMs?: number;
};

export type ReuseMissContext = {
  entries: readonly ActionEntry[];
  catalog: Readonly<Record<string, ActionCatalogEntry>>;
  priorEvents: readonly ReuseEvent[];
  /** Cross-run Action health (QA_ROOT/.qa-loop/action-health.json); only adds hints, never blocks. */
  health?: ActionHealthView;
};

function describe(candidate: MissCandidate, context: ReuseMissContext): string {
  if (candidate.denied) return `${candidate.name} (denied): denied`;
  const entry = context.entries.find((item) => item.name === candidate.name);
  const health = entry ? noticeFor(context.health, entry) : null;
  if (health?.status === "suspected_drift") {
    return `${candidate.name} (runnable, suspected_drift): ${health.notice}`;
  }
  return `${candidate.name} (runnable): not_found if lookup missed it, precondition or drift if it did not apply`;
}

/**
 * Validates a new miss before it is written (and, for Computer Use, before the
 * step runs). Returns null when the intent ID is already logged: only the first
 * step of an intent counts. Throws when the intent is a browser primitive, when
 * `absent` is claimed although the library has candidates, or when a reason that
 * points at an Action does not name a real one.
 */
export function prepareReuseMiss(input: ReuseMissInput, context: ReuseMissContext): ReuseEvent | null {
  const primitive = browserPrimitiveIntent(input.intentId, input.intent);
  if (primitive) {
    throw new Error(
      `"${input.intentId}" is a browser primitive (${primitive}), not a business intent. ` +
      "Run it without --intent-id as a step of the current business intent, or name the intent by its business end point."
    );
  }
  if (context.priorEvents.some((event) => event.intentId === input.intentId)) return null;
  const reason = (input.reason ?? "absent") as ReuseMissReason;
  if ((LEGACY_REUSE_MISS_REASONS as readonly string[]).includes(reason)) {
    throw new Error(
      `Miss reason ${reason} is retired: shared execution is default-allow. Use denied for an Action the ` +
      "shared-execution denylist blocks, otherwise not_found, precondition or drift"
    );
  }
  if (!REUSE_MISS_REASONS.includes(reason)) {
    throw new Error(`Miss reason must be one of ${REUSE_MISS_REASONS.join(", ")}`);
  }
  const indexed = new Set(context.entries.map((entry) => entry.name));
  if (input.action !== undefined && !indexed.has(input.action)) {
    throw new Error(`${input.action} is not an indexed Action`);
  }
  if (NAMES_ACTION.has(reason) && !input.action) {
    throw new Error(`Miss reason ${reason} must name the library Action with --miss-action`);
  }
  if (reason === "denied" && !sharedActionDenial(input.action!)) {
    throw new Error(`${input.action} is not denied for shared execution; use not_found, precondition or drift`);
  }
  let reviewedCandidates: string[] | undefined;
  if (reason === "absent") {
    const candidates = findMissCandidates(context.entries, context.catalog, input.intentId, input.intent);
    const reviewed = new Set(input.reviewedCandidates ?? []);
    const unreviewed = candidates.filter((candidate) => !reviewed.has(candidate.name));
    if (unreviewed.length) {
      throw new Error(
        `Refusing to record "${input.intentId}" as absent: the Action library has candidates:\n` +
        unreviewed.slice(0, 8).map((candidate) => `  - ${describe(candidate, context)}`).join("\n") +
        "\nUse --miss-reason not_found|denied|precondition|drift with --miss-action <name>, " +
        "or, after opening each candidate and finding it inapplicable, pass --absent-reviewed <names>."
      );
    }
    if (candidates.length) reviewedCandidates = candidates.map((candidate) => candidate.name);
  }
  return validateReuseEvent({
    runId: input.runId,
    caseId: input.caseId,
    intentId: input.intentId,
    intent: input.intent,
    outcome: "miss",
    source: input.source,
    reason,
    ...(input.action ? { action: input.action } : {}),
    ...(reviewedCandidates ? { reviewedCandidates } : {}),
    lookupMs: input.lookupMs ?? 0,
    executionMs: input.executionMs,
  });
}
