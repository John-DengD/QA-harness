import { z } from "zod";

export const Generator = z.enum(["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);

export const Testability = z
  .object({
    state: z.enum(["ready", "Blocked", "NotApplicable"]),
    reason: z.string().min(1).optional(),
  })
  .refine((t) => t.state === "ready" || t.reason !== undefined, {
    message: "Blocked and NotApplicable need a reason (recovery condition / basis)",
  });

export const Case = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  generator: Generator,
  type: z.enum(["happy", "negative", "edge"]),
  expected: z.object({ text: z.string().min(1), sourceRef: z.string().min(1), anchor: z.string().min(1) }),
  preconditions: z.array(z.string()),
  risk: z.string(),
  testability: Testability,
});
export type Case = z.infer<typeof Case>;

export const CasesFile = z.object({ cases: z.array(Case) });
export type CasesFile = z.infer<typeof CasesFile>;
