import { z } from "zod";
import { anchorInSource } from "../anchor";
import { Acceptance } from "../contracts/acceptance";
import { ChangeModel } from "../contracts/change-model";
import type { ExtractReport } from "../contracts/extract-report";
import { callStructured, type LlmTransport } from "../llm/structured";
import type { Runbook } from "../runbook";
import type { SourceDoc } from "../sources/types";
import { extractSystemPrompt, extractUserPrompt } from "./prompts";

const LlmOutput = z.object({
  atoms: z.array(z.object({ text: z.string(), sourceRef: z.string(), anchor: z.string() })),
  changeModel: ChangeModel,
});

/** The LLM proposes; code keeps only atoms whose anchor is verbatim in the cited source. */
export async function extractFromSources(opts: {
  transport: LlmTransport;
  runbook: Runbook;
  sources: SourceDoc[];
  maxRetries: number;
}): Promise<{ acceptance: Acceptance; changeModel: ChangeModel; report: ExtractReport }> {
  const out = await callStructured({
    transport: opts.transport,
    schema: LlmOutput,
    schemaName: "extract_atoms",
    system: extractSystemPrompt(opts.runbook.text("references/knowledge-sources.md")),
    user: extractUserPrompt(opts.sources),
    maxRetries: opts.maxRetries,
  });

  const bySource = new Map(opts.sources.map((s) => [s.ref, s]));
  const atoms: Acceptance["atoms"] = [];
  const dropped: ExtractReport["dropped"] = [];
  for (const a of out.atoms) {
    const src = bySource.get(a.sourceRef);
    if (!src) {
      dropped.push({ ...a, reason: "unknown sourceRef" });
    } else if (!anchorInSource(src.text, a.anchor)) {
      dropped.push({ ...a, reason: "anchor not found in source" });
    } else {
      atoms.push({ id: `A${String(atoms.length + 1).padStart(2, "0")}`, ...a });
    }
  }
  return {
    acceptance: { atoms },
    changeModel: out.changeModel,
    report: { dropped, sources: opts.sources.map((s) => ({ ref: s.ref, title: s.title })) },
  };
}
