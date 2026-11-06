import type { Acceptance } from "../contracts/acceptance";
import type { Case } from "../contracts/cases";
import type { SourceDoc } from "../sources/types";

export function reviewSystemPrompt(caseDesignRules: string): string {
  return [
    "You are an independent reviewer of a test case list. You did not design these cases; judge them only on what you are given.",
    "For EACH case return exactly one entry: `keep`, `drop` or `revise`, with a concrete, non-empty reason.",
    "",
    "Drop a case when: it duplicates another case's failure mechanism (name the case it duplicates); it is outside the scope of the acceptance atoms and sources; its precondition cannot be satisfied in the stated environment; or it performs a side effect nobody authorised.",
    "Use `revise` when the case is worth keeping but is wrong or too vague as written; say exactly what to change. Use `keep` only when the case is correct, in scope and distinct.",
    "Do not invent new cases. Do not change anchors.",
    "",
    "=== Case design rules the cases were built under ===",
    caseDesignRules,
  ].join("\n");
}

export function reviewUserPrompt(cases: Case[], a: Acceptance, sources: SourceDoc[]): string {
  return [
    "## Cases to review",
    JSON.stringify(cases, null, 2),
    "## Acceptance atoms",
    JSON.stringify(a.atoms, null, 2),
    ...sources.map((s) => `## SOURCE ${s.ref}\n${s.text}`),
  ].join("\n\n");
}
