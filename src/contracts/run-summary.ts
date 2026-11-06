import { z } from "zod";

export const RunSummary = z.object({
  executed: z.array(z.string()),
  notAutomated: z.array(z.object({ caseId: z.string(), reason: z.string() })),
  skipped: z.array(z.object({ caseId: z.string(), reason: z.string() })),
  blocked: z.array(z.object({ caseId: z.string(), reason: z.string() })),
  startedAt: z.string(),
  finishedAt: z.string(),
});
export type RunSummary = z.infer<typeof RunSummary>;
