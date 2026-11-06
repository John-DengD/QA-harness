import type { Acceptance } from "../contracts/acceptance";
import type { ChangeModel } from "../contracts/change-model";
import type { Case } from "../contracts/cases";
import type { SourceDoc } from "../sources/types";

export function designSystemPrompt(rules: { caseDesign: string; coverage: string }, maxCases: number): string {
  return [
    "You design a test case plan by running the seven generators (G1-G7) defined below, one by one.",
    "",
    "Output rules:",
    "- `generators` has exactly one entry per generator G1..G7: `produced` with the mechanisms found, or `not_applicable` with a one-sentence reason.",
    "- `cases` lists the planned cases in priority order (highest failure cost x likelihood first). All G1 cases must be included.",
    `- Plan at most ${maxCases} cases in total (G1 cases never count against being dropped; give extra room only to G1).`,
    "- Every case's `expected.sourceRef` must be one of the supplied source refs and `expected.anchor` must be copied from the source exactly as written; never translate, paraphrase or merge. A mechanism without such an authoritative source goes to `candidatePool`, not to `cases`.",
    "- Merge mechanisms that fail for the same reason. State testability honestly: `Blocked` needs a concrete recovery condition, `NotApplicable` needs its basis.",
    "",
    "=== Case design rules ===",
    rules.caseDesign,
    "",
    "=== Coverage and accuracy rules ===",
    rules.coverage,
  ].join("\n");
}

export function designUserPrompt(a: Acceptance, cm: ChangeModel | null, sources: SourceDoc[]): string {
  return [
    "## Acceptance atoms",
    JSON.stringify(a.atoms, null, 2),
    "## Change model",
    cm ? JSON.stringify(cm, null, 2) : "(none)",
    ...sources.map((s) => `## SOURCE ${s.ref}\n${s.text}`),
  ].join("\n\n");
}

export function reviseSystemPrompt(): string {
  return [
    "You revise test cases after review. For each case you are given, return it again with the SAME id, fixing exactly the problem the reviewer named.",
    "Keep `expected.sourceRef` and `expected.anchor` copied exactly from the sources; never translate or paraphrase an anchor. Change nothing the reviewer did not criticise.",
    "Return exactly the requested ids, no others.",
  ].join("\n");
}

export function reviseUserPrompt(cases: Case[], feedback: { caseId: string; reason: string }[], sources: SourceDoc[]): string {
  return [
    "## Cases to revise",
    JSON.stringify(cases, null, 2),
    "## Reviewer feedback",
    JSON.stringify(feedback, null, 2),
    ...sources.map((s) => `## SOURCE ${s.ref}\n${s.text}`),
  ].join("\n\n");
}
