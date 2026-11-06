import { z } from "zod";
import { CasesFile } from "./cases";

/** drop and revise reasons are mandatory and persisted (spec §2 anti-goal). */
export const CaseReviewEntry = z.object({
  caseId: z.string().min(1),
  verdict: z.enum(["keep", "drop", "revise"]),
  reason: z.string().min(1),
});
export type CaseReviewEntry = z.infer<typeof CaseReviewEntry>;

export const CaseReviewFile = z.object({ entries: z.array(CaseReviewEntry) });
export const CasesReviewedFile = CasesFile;
