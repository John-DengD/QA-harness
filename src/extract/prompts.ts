import type { SourceDoc } from "../sources/types";

export function extractSystemPrompt(knowledgeSourceRules: string): string {
  return [
    "You extract testable acceptance atoms from the supplied ticket / PR / goal texts, and a change model.",
    "",
    "Rules:",
    "- Each atom is one observable behaviour that the source states explicitly. Do not invent requirements; code or diffs alone never define an expectation.",
    "- Every atom must have `sourceRef` (exactly one of the supplied source refs) and `anchor`: a fragment copied from that source's text exactly as written.",
    "- The anchor must be copied from the source text exactly; never translate, paraphrase, summarise or merge fragments. Keep the source's own language.",
    "- If the source states no testable behaviour, return an empty atoms list.",
    "- The change model lists the surfaces, entities, state transitions and side effects the change touches, as far as the sources say.",
    "",
    "Knowledge-source rules of this QA project (priority of sources, what may define an expectation):",
    knowledgeSourceRules,
  ].join("\n");
}

export function extractUserPrompt(sources: SourceDoc[]): string {
  return sources.map((s) => `### SOURCE ${s.ref}\n${s.title}\n\n${s.text}`).join("\n\n---\n\n");
}
