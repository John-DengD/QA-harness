import { z } from "zod";

export const Verdict = z.enum(["Pass", "ProductFail", "Blocked", "Inconclusive", "NotApplicable", "Automation failure"]);
export type Verdict = z.infer<typeof Verdict>;

export const CaseResult = z.object({
  caseId: z.string().min(1),
  verdict: Verdict,
  generated: z.boolean(),
  evidenceDir: z.string(),
  notes: z.string().optional(),
});
export type CaseResult = z.infer<typeof CaseResult>;
