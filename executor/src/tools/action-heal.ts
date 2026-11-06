import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseReuseLog, type ReuseEvent } from "./action-index";
import { normalizeIntent, type ActionTable } from "./action-table";

/**
 * Action-miss self-repair (Loop Engineering Hook 1). Every miss in a run's
 * action-reuse.jsonl must end with a recorded handling outcome in
 * RUN_ROOT/run-state/action-heal.json, so a miss is never just counted and
 * forgotten:
 *
 * - drift → repaired (action:drift verify passed) | gap (script_drift) | deferred (with why);
 * - absent / not_found / novel / precondition → new_candidate | extended | gap | deferred;
 * - denied / unsafe → additionally not_repairable.
 */
export const HEAL_OUTCOMES = ["repaired", "new_candidate", "extended", "gap", "deferred", "not_repairable"] as const;
export type HealOutcomeKind = (typeof HEAL_OUTCOMES)[number];
type MissReason = NonNullable<ReuseEvent["reason"]>;

export type HealOutcome = {
  intentId?: string;
  intent?: string;
  reason: MissReason;
  outcome: HealOutcomeKind;
  actionName?: string;
  evidenceRef?: string;
  gapId?: string;
  deferReason?: string;
};

export const HEAL_FILE = path.join("run-state", "action-heal.json");

const ADD_OR_DEFER: readonly HealOutcomeKind[] = ["new_candidate", "extended", "gap", "deferred"];
const ALLOWED: Record<MissReason, readonly HealOutcomeKind[]> = {
  drift: ["repaired", "gap", "deferred"],
  absent: ADD_OR_DEFER,
  not_found: ADD_OR_DEFER,
  novel: ADD_OR_DEFER,
  precondition: ADD_OR_DEFER,
  denied: [...ADD_OR_DEFER, "not_repairable"],
  not_allowlisted: [...ADD_OR_DEFER, "not_repairable"],
  unsafe: [...ADD_OR_DEFER, "not_repairable"],
  other: [...ADD_OR_DEFER, "not_repairable"],
};
const NEEDS_ACTION: readonly HealOutcomeKind[] = ["repaired", "new_candidate", "extended"];

export function allowedHealOutcomes(reason: MissReason | undefined): readonly HealOutcomeKind[] {
  return ALLOWED[reason ?? "other"] ?? ALLOWED.other;
}

export function validateHealOutcomes(raw: unknown): HealOutcome[] {
  if (!Array.isArray(raw)) throw new Error("action-heal.json must be an array of outcomes");
  return raw.map((value, index) => {
    const entry = value as Record<string, unknown>;
    const where = `action-heal.json[${index}]`;
    if (!entry || typeof entry !== "object") throw new Error(`${where} must be an object`);
    const hasId = typeof entry.intentId === "string" && entry.intentId.trim();
    const hasIntent = typeof entry.intent === "string" && entry.intent.trim();
    if (!hasId && !hasIntent) throw new Error(`${where} needs intentId or intent`);
    if (typeof entry.reason !== "string" || !Object.hasOwn(ALLOWED, entry.reason)) throw new Error(`${where} has invalid reason`);
    if (!(HEAL_OUTCOMES as readonly string[]).includes(String(entry.outcome))) {
      throw new Error(`${where} has invalid outcome ${String(entry.outcome)}; use ${HEAL_OUTCOMES.join(" | ")}`);
    }
    for (const field of ["actionName", "evidenceRef", "gapId", "deferReason"]) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") throw new Error(`${where}.${field} must be a string`);
    }
    return entry as HealOutcome;
  });
}

export type HealResolved = { caseId: string; intentId: string; intent: string; reason: string; outcome: HealOutcomeKind };
export type HealUnresolved = {
  caseId: string; intentId: string; intent: string; reason: string; action: string | null;
  problem: string; allowed: readonly HealOutcomeKind[];
};
export type HealCheck = { ok: boolean; total: number; resolved: HealResolved[]; unresolved: HealUnresolved[] };

function matches(outcome: HealOutcome, miss: ReuseEvent): boolean {
  if (outcome.intentId !== undefined && outcome.intentId.trim()) return outcome.intentId === miss.intentId;
  return outcome.intent !== undefined && normalizeIntent(outcome.intent) === normalizeIntent(miss.intent);
}

function outcomeProblem(outcome: HealOutcome, miss: ReuseEvent): string | null {
  const reason = miss.reason ?? "other";
  if (!allowedHealOutcomes(miss.reason).includes(outcome.outcome)) {
    return `outcome ${outcome.outcome} is not allowed for a ${reason} miss`;
  }
  if (outcome.outcome === "deferred" && !outcome.deferReason?.trim()) return "deferred needs a non-empty deferReason";
  if (NEEDS_ACTION.includes(outcome.outcome) && !outcome.actionName?.trim()) {
    return `${outcome.outcome} needs the actionName it repaired, added or extended`;
  }
  return null;
}

/** Pairs each miss with a valid outcome; a miss without one is listed with what is wrong. */
export function evaluateHeal(misses: readonly ReuseEvent[], outcomes: readonly HealOutcome[]): HealCheck {
  const resolved: HealResolved[] = [];
  const unresolved: HealUnresolved[] = [];
  for (const miss of misses) {
    const reason = miss.reason ?? "other";
    const candidates = outcomes.filter((outcome) => outcome.reason === reason && matches(outcome, miss));
    const valid = candidates.find((outcome) => outcomeProblem(outcome, miss) === null);
    if (valid) {
      resolved.push({ caseId: miss.caseId, intentId: miss.intentId, intent: miss.intent, reason, outcome: valid.outcome });
      continue;
    }
    unresolved.push({
      caseId: miss.caseId, intentId: miss.intentId, intent: miss.intent, reason, action: miss.action ?? null,
      problem: candidates.length ? outcomeProblem(candidates[0], miss)! : "no outcome",
      allowed: allowedHealOutcomes(miss.reason),
    });
  }
  return { ok: unresolved.length === 0, total: misses.length, resolved, unresolved };
}

/** The run's misses (settled drift cross-checks included); hits, pending reads and not_reusable are not misses. */
export async function loadRunMisses(runRoot: string): Promise<ReuseEvent[]> {
  const log = await readFile(path.join(runRoot, "run-state", "action-reuse.jsonl"), "utf8");
  return parseReuseLog(log).events.filter((event) => event.outcome === "miss");
}

export async function loadHealOutcomes(runRoot: string): Promise<HealOutcome[]> {
  try {
    return validateHealOutcomes(JSON.parse(await readFile(path.join(runRoot, HEAL_FILE), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function checkRunHeal(runRoot: string): Promise<HealCheck> {
  return evaluateHeal(await loadRunMisses(runRoot), await loadHealOutcomes(runRoot));
}

export type HealHandling =
  | "repair_action"
  | "add_minimal_action_now"
  | "new_candidate_or_gap"
  | "extend_existing_action"
  | "not_repairable_or_gap";

export type HealPlanItem = {
  intent: string;
  reason: string;
  count: number;
  caseIds: string[];
  intentIds: string[];
  action: string | null;
  handling: HealHandling;
  allowed: readonly HealOutcomeKind[];
  flags: string[];
  summary: string;
  commands: string[];
};

// Effects no library Action takes back (see action-table.ts rollback levels), plus spend.
const IRREVERSIBLE_INTENT = /\b(?:launch|approve|cancel|remove|delete|spend|generate|send|top ?up|pay|charge)\b|上线|批准|取消|删除|移除|生成|发送|充值|扣费|支付|付款/i;
const HIGH_COST_MS = 30_000;

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * Per group of identical intents (same normalized text and reason): the kind of
 * handling the miss needs and commands to start from. An absent intent seen
 * twice or more, or one that is irreversible / costly to redo by hand, is
 * flagged "add a minimal Action now".
 */
export function planHeal(misses: readonly ReuseEvent[], input: { runRoot: string; catalog: Readonly<ActionTable> }): HealPlanItem[] {
  const groups = new Map<string, ReuseEvent[]>();
  for (const miss of misses) {
    const key = `${miss.reason ?? "other"}\0${normalizeIntent(miss.intent)}`;
    groups.set(key, [...(groups.get(key) ?? []), miss]);
  }
  const reuseLog = path.join(input.runRoot, "run-state", "action-reuse.jsonl");
  return [...groups.values()].map((group) => {
    const first = group[0];
    const reason = first.reason ?? "other";
    const action = group.find((miss) => miss.action)?.action ?? null;
    const base = {
      intent: first.intent, reason, count: group.length,
      caseIds: [...new Set(group.map((miss) => miss.caseId))], intentIds: group.map((miss) => miss.intentId),
      action, allowed: allowedHealOutcomes(first.reason),
    };
    if (reason === "drift") {
      return { ...base, handling: "repair_action" as const, flags: [],
        summary: `${action ?? "该 Action"} 疑似漂移：对照产品源码最小修复后 verify；修不了登记 script_drift gap 或写明 deferReason`,
        commands: [
          `pnpm action:drift list --run-root ${input.runRoot}`,
          ...(action ? [`pnpm action:drift verify ${action} --sandbox-id <id> --case-dir ${input.runRoot}/evidence/<case>-drift-verify ` +
            `--origin <app URL> --reuse-log ${reuseLog} --run-id ${first.runId}`] : []),
        ] };
    }
    if (reason === "precondition") {
      return { ...base, handling: "extend_existing_action" as const, flags: [],
        summary: action
          ? `扩展已有 Action ${action}，让它覆盖这次缺的前置条件（记 extended）；不值得就 gap / deferred`
          : "找到最接近的已有 Action 扩展前置条件（记 extended），或新增候选 / gap / deferred",
        commands: action ? [`pnpm action:select select --intent ${shellQuote(first.intent)}`] : [] };
    }
    if (reason === "denied" || reason === "unsafe" || reason === "not_allowlisted") {
      return { ...base, handling: "not_repairable_or_gap" as const, flags: [],
        summary: "共享执行禁止或不安全：记 not_repairable（或改造后 new_candidate / gap）", commands: [] };
    }
    const flags: string[] = [];
    if (group.length >= 2) flags.push("seen_2_or_more");
    const rowIrreversible = action !== null && input.catalog[action]?.rollback === "irreversible";
    const costMs = group.reduce((sum, miss) => sum + miss.executionMs, 0);
    if (rowIrreversible || IRREVERSIBLE_INTENT.test(first.intent) || costMs >= HIGH_COST_MS) flags.push("irreversible_or_high_cost");
    const now = flags.length > 0;
    return { ...base, handling: now ? "add_minimal_action_now" as const : "new_candidate_or_gap" as const, flags,
      summary: now
        ? `现在就补一个最小 Action（${flags.join(", ")}），记 new_candidate`
        : "补候选 Action（new_candidate）、扩展已有 Action（extended），或登记 gap / deferred",
      commands: [`pnpm action:select select --intent ${shellQuote(first.intent)}`] };
  });
}
