import { z } from "zod";
import { anchorInSource } from "../anchor";
import type { Acceptance } from "../contracts/acceptance";
import { CaseReviewEntry } from "../contracts/case-review";
import type { Case } from "../contracts/cases";
import { callStructured, type LlmTransport } from "../llm/structured";
import type { Runbook } from "../runbook";
import type { SourceDoc } from "../sources/types";
import { reviewSystemPrompt, reviewUserPrompt } from "./prompts";

export async function reviewCases(opts: {
  transport: LlmTransport;
  runbook: Runbook;
  cases: Case[];
  acceptance: Acceptance;
  sources: SourceDoc[];
  maxRetries: number;
  round: number;
  maxRevisions: number;
}): Promise<{ entries: CaseReviewEntry[]; reviewed: Case[] }> {
  const bySource = new Map(opts.sources.map((s) => [s.ref, s]));
  const codeDrops = new Map<string, CaseReviewEntry>();
  const forModel: Case[] = [];
  for (const c of opts.cases) {
    const src = bySource.get(c.expected.sourceRef);
    if (!src || !anchorInSource(src.text, c.expected.anchor)) {
      codeDrops.set(c.id, { caseId: c.id, verdict: "drop", reason: "anchor not found in source (checked by code)" });
    } else {
      forModel.push(c);
    }
  }

  let modelEntries: CaseReviewEntry[] = [];
  if (forModel.length > 0) {
    const want = new Set(forModel.map((c) => c.id));
    const schema = z.object({ entries: z.array(CaseReviewEntry) }).superRefine((o, ctx) => {
      const got = o.entries.map((e) => e.caseId);
      const missing = [...want].filter((id) => !got.includes(id));
      const extra = got.filter((id) => !want.has(id));
      if (missing.length || extra.length || new Set(got).size !== got.length) {
        ctx.addIssue({ code: "custom", message: `need exactly one entry per case id (missing: ${missing.join(",") || "none"}; unexpected or repeated: ${extra.join(",") || "none"})` });
      }
    });
    modelEntries = (
      await callStructured({
        transport: opts.transport,
        schema,
        schemaName: "review_cases",
        system: reviewSystemPrompt(opts.runbook.text("references/case-design.md")),
        user: reviewUserPrompt(forModel, opts.acceptance, opts.sources),
        maxRetries: opts.maxRetries,
      })
    ).entries;
  }

  const modelById = new Map(modelEntries.map((e) => [e.caseId, e]));
  const entries = opts.cases.map((c): CaseReviewEntry => {
    const e = codeDrops.get(c.id) ?? modelById.get(c.id)!;
    if (e.verdict === "revise" && opts.round > opts.maxRevisions) {
      return { caseId: c.id, verdict: "drop", reason: `revise limit reached (${opts.maxRevisions} revisions). Last reviewer feedback: ${e.reason}` };
    }
    return e;
  });
  const keep = new Set(entries.filter((e) => e.verdict === "keep").map((e) => e.caseId));
  return { entries, reviewed: opts.cases.filter((c) => keep.has(c.id)) };
}
