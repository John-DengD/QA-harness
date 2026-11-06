import { z } from "zod";
import type { Case } from "../contracts/cases";
import { type Runbook, RunbookError } from "../runbook";

const Bindings = z.object({ bindings: z.array(z.object({ title: z.string().min(1), spec: z.string().min(1), grep: z.string().optional() })) });
const Authorized = z.object({ authorized: z.array(z.string().min(1)) });

function loadJson<T>(runbook: Runbook, file: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(runbook.text(file));
  } catch (e) {
    throw new RunbookError(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new RunbookError(`invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

export type Binding = { title: string; spec: string; grep?: string };

export const loadBindings = (runbook: Runbook): Binding[] => loadJson(runbook, "script-bindings.json", Bindings).bindings;
export const loadAuthorizedSideEffects = (runbook: Runbook): string[] => loadJson(runbook, "authorized-side-effects.json", Authorized).authorized;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Deterministic lookup of an existing script by exact (normalised) case title (spec §5). */
export function findExistingScript(c: Case, bindings: Binding[]): { spec: string; grep?: string } | null {
  const hit = bindings.find((b) => norm(b.title) === norm(c.title));
  return hit ? { spec: hit.spec, ...(hit.grep ? { grep: hit.grep } : {}) } : null;
}

export function gateSideEffects(declared: string[], authorized: string[]): { ok: true } | { ok: false; unauthorized: string[] } {
  const allowed = new Set(authorized);
  const unauthorized = declared.filter((d) => !allowed.has(d));
  return unauthorized.length === 0 ? { ok: true } : { ok: false, unauthorized };
}
