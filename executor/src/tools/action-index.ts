import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import type { Identifier, Node, TSTypeReference } from "@babel/types";

export type ActionEntry = {
  name: string;
  domain: string;
  file: string;
  line: number;
  signature: string;
  hot: boolean;
};

/**
 * Non-Case phases: Action calls made while signing in / preparing (`setup`) or
 * closing out (`cleanup`). They are logged like Case intents but belong to no
 * Case, are reported apart and never enter the Case hit-rate denominator.
 */
export const NON_CASE_PHASES = ["setup", "cleanup"] as const;
export type NonCasePhase = (typeof NON_CASE_PHASES)[number];
export function isNonCasePhase(caseId: string): caseId is NonCasePhase {
  return (NON_CASE_PHASES as readonly string[]).includes(caseId);
}

/**
 * A Case ID new writers (e2b:action, computer-use act) accept: `case-<N>`, a
 * Case key (letters, digits, `.`, `_`, `-`, `:`), or a reserved non-Case phase
 * (`setup` / `cleanup`). Parsing stays lenient so older logs still read.
 */
export const REUSE_CASE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

/** Throws a message that names the legal identities when a new event's Case ID is not one. */
export function assertWritableCaseId(caseId: string): void {
  if (!REUSE_CASE_ID.test(caseId)) {
    throw new Error(`Invalid case ID "${caseId}": use case-<N> (or the Case key) for a Case, ` +
      `or --phase setup / --phase cleanup for sign-in, preparation and closeout calls that belong to no Case`);
  }
}

export type CrossCheckSettlement = {
  result: "hit" | "drift";
  confirmedAt: string;
  reasons: string[];
  evidenceRef?: string;
};

export type ReuseEvent = {
  runId: string;
  caseId: string;
  intentId: string;
  intent: string;
  /**
   * `pending_crosscheck`: an observation Action completed but its reading tripped the
   * silent-drift guard; it is neither hit nor miss until `action:reuse confirm` settles it.
   */
  outcome: "hit" | "miss" | "not_reusable" | "pending_crosscheck";
  source: "hot" | "index" | "computer-use" | "playwright-explore" | "none";
  action?: string;
  /** `not_allowlisted` is a retired value kept so old logs still parse; new misses never write it. */
  reason?: "absent" | "not_found" | "denied" | "not_allowlisted" | "precondition" | "drift" | "unsafe" | "novel" | "other";
  /** For an absent miss: library candidates the operator opened and judged inapplicable. */
  reviewedCandidates?: string[];
  notReusableReason?: "one_off" | "visual_only" | "unsafe_to_reuse";
  /** Required for an indexed/hot hit. Exploratory misses intentionally omit it. */
  invocationId?: string;
  factRef?: string;
  factSha256?: string;
  lookupMs: number;
  executionMs: number;
  /** Why the reading needs a screenshot cross-check (pending_crosscheck only). */
  crossCheckReasons?: string[];
  /** Set when a pending cross-check was settled (folded in by parseReuseLog, never written). */
  crossCheck?: CrossCheckSettlement;
};

/** A settlement line appended by `action:reuse confirm`; it adds no run/case/intent key. */
export type CrossCheckResolution = {
  kind: "crosscheck_resolution";
  runId: string;
  caseId: string;
  intentId: string;
  result: "hit" | "drift";
  confirmedAt: string;
  /** RUN_ROOT-relative screenshot or fact the operator compared against. */
  evidenceRef?: string;
};

export type ReusePreflight = {
  kind: "preflight";
  runId: string;
  createdAt: string;
  domain?: string;
  indexedActions: number;
  hotCandidates: string[];
};

function firstParameterIsPage(params: readonly Node[]): boolean {
  const first = params[0];
  if (!first || first.type !== "Identifier") return false;
  const identifier = first as Identifier;
  const annotation = identifier.typeAnnotation?.type === "TSTypeAnnotation"
    ? identifier.typeAnnotation.typeAnnotation as TSTypeReference
    : undefined;
  return identifier.name === "page" &&
    annotation?.type === "TSTypeReference" &&
    annotation.typeName.type === "Identifier" &&
    annotation.typeName.name === "Page";
}

export function actionsFromSource(sourceText: string, file: string): Omit<ActionEntry, "hot">[] {
  const source = parse(sourceText, { sourceType: "module", plugins: ["typescript"] });
  const domain = path.basename(file, ".ts").replace(/-actions$/, "");
  const entries: Omit<ActionEntry, "hot">[] = [];
  for (const statement of source.program.body) {
    if (statement.type !== "ExportNamedDeclaration" || !statement.declaration) continue;
    const declaration = statement.declaration;
    if (declaration.type === "FunctionDeclaration" && declaration.id &&
        firstParameterIsPage(declaration.params)) {
      entries.push({
        name: declaration.id.name, domain, file, line: declaration.loc?.start.line ?? 0,
        signature: sourceText.slice(declaration.start ?? 0, declaration.body?.start ?? declaration.end ?? 0)
          .trim().replace(/\s+/g, " ").slice(0, 260),
      });
    }
    if (declaration.type === "VariableDeclaration") {
      for (const variable of declaration.declarations) {
        if (variable.id.type !== "Identifier" || variable.init?.type !== "ArrowFunctionExpression" ||
            !firstParameterIsPage(variable.init.params)) continue;
        entries.push({
          name: variable.id.name, domain, file, line: variable.loc?.start.line ?? 0,
          signature: sourceText.slice(variable.start ?? 0, variable.init.body.start ?? variable.end ?? 0)
            .trim().replace(/\s+/g, " ").slice(0, 260),
        });
      }
    }
  }
  return entries;
}

export async function actionIndex(root: string, hotNames: readonly string[]): Promise<ActionEntry[]> {
  const files = (await readdir(path.join(root, "src/actions"))).filter((name) => name.endsWith("-actions.ts"));
  const entries = (await Promise.all(files.map(async (name) => {
    const file = `src/actions/${name}`;
    return actionsFromSource(await readFile(path.join(root, file), "utf8"), file);
  }))).flat();
  const names = new Set(entries.map((entry) => entry.name));
  const stale = hotNames.filter((name) => !names.has(name));
  if (stale.length) throw new Error(`Stale hot actions: ${stale.join(", ")}`);
  return entries.map((entry) => ({ ...entry, hot: hotNames.includes(entry.name) }))
    .sort((a, b) => Number(b.hot) - Number(a.hot) || a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
}

function words(text: string): string[] {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .split(/[^a-z0-9]+/).filter((word) => word.length > 1);
}

export function findActions(entries: readonly ActionEntry[], query: string, domain?: string): ActionEntry[] {
  const wanted = new Set(words(query));
  if (!wanted.size) return [];
  return entries.map((entry) => {
    const terms = new Set(words(`${entry.name} ${entry.domain}`));
    const matched = [...wanted].filter((word) => terms.has(word)).length;
    const sameDomain = !domain || entry.domain === domain;
    return { entry, score: sameDomain ? matched * 10 + (matched ? Number(entry.hot) * 3 : 0) : 0 };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
}

export function validateReuseEvent(value: unknown): ReuseEvent {
  if (!value || typeof value !== "object") throw new Error("Reuse event must be an object");
  const event = value as Record<string, unknown>;
  for (const field of ["runId", "caseId", "intentId", "intent"]) {
    if (typeof event[field] !== "string" || !event[field] || event[field].length > 160) {
      throw new Error(`Invalid ${field}`);
    }
  }
  if (!["hit", "miss", "not_reusable", "pending_crosscheck"].includes(String(event.outcome)) ||
      !["hot", "index", "computer-use", "playwright-explore", "none"].includes(String(event.source)) ||
      !Number.isFinite(event.lookupMs) || Number(event.lookupMs) < 0 ||
      !Number.isFinite(event.executionMs) || Number(event.executionMs) < 0) {
    throw new Error("Invalid reuse event outcome, source, or timing");
  }
  if (event.outcome === "hit" && (!event.action || !["hot", "index"].includes(String(event.source)))) {
    throw new Error("A hit needs an Action and an index source");
  }
  if (event.outcome === "pending_crosscheck" &&
      (!event.action || !["hot", "index"].includes(String(event.source)) ||
       typeof event.invocationId !== "string" || typeof event.factRef !== "string" || typeof event.factSha256 !== "string" ||
       !Array.isArray(event.crossCheckReasons) || !event.crossCheckReasons.length ||
       !event.crossCheckReasons.every((reason: unknown) => typeof reason === "string" && reason.length > 0))) {
    throw new Error("A pending cross-check needs an Action, an index source, its invocation fact and the cross-check reasons");
  }
  if (event.crossCheckReasons !== undefined && event.outcome !== "pending_crosscheck") {
    throw new Error("crossCheckReasons only applies to a pending cross-check");
  }
  if (event.invocationId !== undefined &&
      (typeof event.invocationId !== "string" ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.invocationId))) {
    throw new Error("invocationId must be a UUID");
  }
  if (event.factRef !== undefined && (typeof event.factRef !== "string" || !event.factRef || event.factRef.length > 1000)) {
    throw new Error("factRef must be a nonempty path");
  }
  if (event.factSha256 !== undefined &&
      (typeof event.factSha256 !== "string" || !/^[a-f0-9]{64}$/.test(event.factSha256))) {
    throw new Error("factSha256 must be a SHA-256 hash");
  }
  if (event.outcome === "hit" &&
      (typeof event.invocationId !== "string" || typeof event.factRef !== "string" || typeof event.factSha256 !== "string")) {
    throw new Error("A hit needs a completed invocation fact reference");
  }
  if (event.outcome === "miss" &&
      (!["absent", "not_found", "denied", "not_allowlisted", "precondition", "drift", "unsafe", "novel", "other"].includes(String(event.reason)) ||
       !["computer-use", "playwright-explore"].includes(String(event.source)))) {
    throw new Error("A miss needs a reason and an exploration fallback");
  }
  if (event.reviewedCandidates !== undefined &&
      (event.outcome !== "miss" || event.reason !== "absent" || !Array.isArray(event.reviewedCandidates) ||
       !event.reviewedCandidates.every((name: unknown) => typeof name === "string" && /^[A-Za-z_$][\w$]{0,99}$/.test(name)))) {
    throw new Error("reviewedCandidates only applies to an absent miss and must list Action names");
  }
  if (event.outcome === "not_reusable" &&
      (event.source !== "none" ||
       !["one_off", "visual_only", "unsafe_to_reuse"].includes(String(event.notReusableReason)))) {
    throw new Error("A non-reusable intent needs an exclusion reason");
  }
  return event as ReuseEvent;
}

export function validateReusePreflight(value: unknown): ReusePreflight {
  if (!value || typeof value !== "object") throw new Error("Missing Action reuse preflight");
  const preflight = value as Record<string, unknown>;
  if (preflight.kind !== "preflight" || typeof preflight.runId !== "string" ||
      !preflight.runId || preflight.runId.length > 160 ||
      typeof preflight.createdAt !== "string" || !Number.isFinite(Date.parse(preflight.createdAt)) ||
      (preflight.domain !== undefined && (typeof preflight.domain !== "string" || !preflight.domain)) ||
      !Number.isInteger(preflight.indexedActions) || Number(preflight.indexedActions) < 0 ||
      !Array.isArray(preflight.hotCandidates) ||
      !preflight.hotCandidates.every((name: unknown) => typeof name === "string" && name.length > 0)) {
    throw new Error("Invalid Action reuse preflight");
  }
  return preflight as ReusePreflight;
}

export function validateCrossCheckResolution(value: unknown): CrossCheckResolution {
  if (!value || typeof value !== "object") throw new Error("Cross-check resolution must be an object");
  const line = value as Record<string, unknown>;
  for (const field of ["runId", "caseId", "intentId"]) {
    if (typeof line[field] !== "string" || !line[field] || (line[field] as string).length > 160) {
      throw new Error(`Invalid cross-check resolution ${field}`);
    }
  }
  if (line.kind !== "crosscheck_resolution" || (line.result !== "hit" && line.result !== "drift") ||
      typeof line.confirmedAt !== "string" || !Number.isFinite(Date.parse(line.confirmedAt)) ||
      (line.evidenceRef !== undefined && (typeof line.evidenceRef !== "string" || !line.evidenceRef || line.evidenceRef.length > 1000))) {
    throw new Error("Invalid cross-check resolution: needs result hit|drift and confirmedAt");
  }
  return line as CrossCheckResolution;
}

/** Applies one settlement to its pending event: a confirmed reading is a hit, a refuted one a drift miss. */
export function settlePendingCrossCheck(event: ReuseEvent, resolution: CrossCheckResolution): ReuseEvent {
  const crossCheck: CrossCheckSettlement = {
    result: resolution.result, confirmedAt: resolution.confirmedAt, reasons: event.crossCheckReasons ?? [],
    ...(resolution.evidenceRef ? { evidenceRef: resolution.evidenceRef } : {}),
  };
  const { crossCheckReasons: _reasons, ...base } = event;
  return resolution.result === "hit"
    ? { ...base, outcome: "hit", crossCheck }
    : { ...base, outcome: "miss", source: "computer-use", reason: "drift", crossCheck };
}

/**
 * Parses the append-only reuse log. Pending cross-checks are folded with their
 * `crosscheck_resolution` line; those still unsettled stay `pending_crosscheck`
 * in `events` and are also listed in `pendingCrossChecks`.
 */
export function parseReuseLog(contents: string): {
  preflight: ReusePreflight; events: ReuseEvent[]; pendingCrossChecks: ReuseEvent[];
} {
  const lines = contents.split("\n").filter((line) => line.trim());
  if (!lines.length) throw new Error("Action reuse log is empty: run preflight before testing");
  const preflight = validateReusePreflight(JSON.parse(lines[0]));
  const raw: ReuseEvent[] = [];
  const resolutions: CrossCheckResolution[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const value = JSON.parse(line) as Record<string, unknown>;
    const entry = value?.kind === "crosscheck_resolution" ? validateCrossCheckResolution(value) : validateReuseEvent(value);
    if (entry.runId !== preflight.runId) {
      throw new Error(`Action reuse log line ${index + 2} has a different runId`);
    }
    if ("kind" in entry && entry.kind === "crosscheck_resolution") resolutions.push(entry);
    else raw.push(entry as ReuseEvent);
  }
  summarizeReuse(raw);
  const events = [...raw];
  const settled = new Set<number>();
  for (const resolution of resolutions) {
    const index = events.findIndex((event) =>
      event.caseId === resolution.caseId && event.intentId === resolution.intentId);
    const target = index < 0 ? undefined : raw[index];
    if (!target || target.outcome !== "pending_crosscheck") {
      throw new Error(`Cross-check resolution for ${resolution.caseId}/${resolution.intentId} has no pending cross-check`);
    }
    if (settled.has(index)) throw new Error(`Cross-check for ${resolution.caseId}/${resolution.intentId} is already settled`);
    settled.add(index);
    events[index] = settlePendingCrossCheck(target, resolution);
  }
  summarizeReuse(events);
  return { preflight, events, pendingCrossChecks: events.filter((event) => event.outcome === "pending_crosscheck") };
}

/** The reuse log's identity rule: one event per run, Case and intent (see summarizeReuse). */
export function hasReuseEvent(
  events: readonly ReuseEvent[],
  runId: string,
  caseId: string,
  intentId: string
): boolean {
  return events.some((event) =>
    event.runId === runId && event.caseId === caseId && event.intentId === intentId);
}

export function summarizeReuse(events: readonly ReuseEvent[]) {
  const keys = events.map((event) => `${event.runId}\0${event.caseId}\0${event.intentId}`);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate run/case/intent ID in reuse log");
  const invocationIds = events.filter((event) => event.outcome === "hit").map((event) => event.invocationId);
  if (new Set(invocationIds).size !== invocationIds.length) {
    throw new Error("One Action invocation cannot count as multiple hits");
  }
  // setup / cleanup calls belong to no Case: counted apart, never in the Case denominator.
  const caseEvents = events.filter((event) => !isNonCasePhase(event.caseId));
  const phases = Object.fromEntries(NON_CASE_PHASES.map((phase) => {
    const inPhase = events.filter((event) => event.caseId === phase);
    return [phase, {
      intents: inPhase.length,
      hits: inPhase.filter((event) => event.outcome === "hit").length,
      misses: inPhase.filter((event) => event.outcome === "miss").length,
      pendingCrossChecks: inPhase.filter((event) => event.outcome === "pending_crosscheck").length,
    }];
  })) as Record<NonCasePhase, { intents: number; hits: number; misses: number; pendingCrossChecks: number }>;
  const eligible = caseEvents.filter((event) => event.outcome !== "not_reusable");
  const hits = eligible.filter((event) => event.outcome === "hit");
  const misses = eligible.filter((event) => event.outcome === "miss");
  // Unsettled cross-checks stay in the denominator but are not hits until confirmed.
  const pending = eligible.filter((event) => event.outcome === "pending_crosscheck");
  return {
    eligibleIntents: eligible.length,
    hits: hits.length,
    hotHits: hits.filter((event) => event.source === "hot").length,
    misses: misses.length,
    excludedIntents: caseEvents.length - eligible.length,
    pendingCrossChecks: pending.length,
    unconfirmedCrossChecks: pending.map((event) => ({ caseId: event.caseId, intentId: event.intentId, action: event.action })),
    phases,
    hitRate: eligible.length ? hits.length / eligible.length : null,
    missReasons: Object.fromEntries(
      [...new Set(misses.map((event) => event.reason))].sort().map((reason) =>
        [reason, misses.filter((event) => event.reason === reason).length])
    ),
    totalLookupMs: events.reduce((sum, event) => sum + event.lookupMs, 0),
    totalExecutionMs: events.reduce((sum, event) => sum + event.executionMs, 0),
  };
}
