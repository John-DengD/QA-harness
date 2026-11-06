import { z } from "zod";
import { anchorInSource } from "../anchor";
import type { Acceptance } from "../contracts/acceptance";
import type { ChangeModel } from "../contracts/change-model";
import { Case, CaseDraft, Generator } from "../contracts/cases";
import type { GeneratorsFile } from "../contracts/generators";
import { callStructured, type LlmTransport } from "../llm/structured";
import type { Runbook } from "../runbook";
import type { SourceDoc } from "../sources/types";
import { designSystemPrompt, designUserPrompt, reviseSystemPrompt, reviseUserPrompt } from "./prompts";

const GeneratorEntry = z.object({
  generator: Generator,
  conclusion: z.enum(["produced", "not_applicable"]),
  mechanisms: z.array(z.string()),
  reason: z.string().optional(),
});

const DesignOut = z
  .object({
    generators: z.array(GeneratorEntry),
    cases: z.array(CaseDraft),
    candidatePool: z.array(z.object({ mechanism: z.string(), why: z.string() })),
  })
  .superRefine((o, ctx) => {
    const seen = new Set(o.generators.map((g) => g.generator));
    for (const g of Generator.options) {
      if (!seen.has(g)) ctx.addIssue({ code: "custom", message: `generator ${g} has no conclusion` });
    }
    if (o.generators.length !== seen.size) ctx.addIssue({ code: "custom", message: "a generator is concluded more than once" });
    for (const g of o.generators) {
      if (g.conclusion === "not_applicable" && !g.reason?.trim()) {
        ctx.addIssue({ code: "custom", message: `generator ${g.generator} is not_applicable without a reason` });
      }
    }
  });

export async function designCases(opts: {
  transport: LlmTransport;
  runbook: Runbook;
  acceptance: Acceptance;
  changeModel: ChangeModel | null;
  sources: SourceDoc[];
  maxCases: number;
  maxRetries: number;
}): Promise<{ cases: Case[]; generators: GeneratorsFile }> {
  const out = await callStructured({
    transport: opts.transport,
    schema: DesignOut,
    schemaName: "design_cases",
    system: designSystemPrompt(
      {
        caseDesign: opts.runbook.text("references/case-design.md"),
        coverage: opts.runbook.text("references/coverage-and-accuracy.md"),
      },
      opts.maxCases,
    ),
    user: designUserPrompt(opts.acceptance, opts.changeModel, opts.sources),
    maxRetries: opts.maxRetries,
  });

  const bySource = new Map(opts.sources.map((s) => [s.ref, s]));
  const candidatePool = [...out.candidatePool];
  const verified: CaseDraft[] = [];
  for (const d of out.cases) {
    const src = bySource.get(d.expected.sourceRef);
    if (!src) candidatePool.push({ mechanism: d.title, why: `unknown source ${d.expected.sourceRef}` });
    else if (!anchorInSource(src.text, d.expected.anchor)) candidatePool.push({ mechanism: d.title, why: "anchor not found in source" });
    else verified.push(d);
  }

  const g1 = verified.filter((d) => d.generator === "G1").length;
  const allowedOthers = Math.max(opts.maxCases, g1) - g1;
  let othersKept = 0;
  const kept: CaseDraft[] = [];
  const trimmed: GeneratorsFile["trimmed"] = [];
  for (const d of verified) {
    if (d.generator === "G1") kept.push(d);
    else if (othersKept < allowedOthers) { kept.push(d); othersKept++; }
    else trimmed.push({ title: d.title, reason: "over budget" });
  }

  return {
    cases: kept.map((d, i) => ({ id: `C${String(i + 1).padStart(2, "0")}`, ...d })),
    generators: { generators: out.generators, candidatePool, trimmed },
  };
}

export async function reviseCases(opts: {
  transport: LlmTransport;
  runbook: Runbook;
  cases: Case[];
  feedback: { caseId: string; reason: string }[];
  sources: SourceDoc[];
  acceptance: Acceptance;
  maxRetries: number;
}): Promise<Case[]> {
  const want = new Set(opts.feedback.map((f) => f.caseId));
  const schema = z.object({ cases: z.array(Case) }).superRefine((o, ctx) => {
    const got = o.cases.map((c) => c.id);
    if (got.length !== want.size || got.some((id) => !want.has(id)) || new Set(got).size !== got.length) {
      ctx.addIssue({ code: "custom", message: `must return exactly the ids ${[...want].join(", ")}` });
    }
  });
  const out = await callStructured({
    transport: opts.transport,
    schema,
    schemaName: "revise_cases",
    system: reviseSystemPrompt(),
    user: reviseUserPrompt(opts.cases.filter((c) => want.has(c.id)), opts.feedback, opts.sources),
    maxRetries: opts.maxRetries,
  });
  return out.cases;
}

