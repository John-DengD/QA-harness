import { z } from "zod";
import { Generator } from "./cases";

/** Every generator must conclude: mechanisms produced, or not applicable with a reason (spec §5). */
export const GeneratorsFile = z.object({
  generators: z.array(
    z.object({
      generator: Generator,
      conclusion: z.enum(["produced", "not_applicable"]),
      mechanisms: z.array(z.string()),
      reason: z.string().optional(),
    }),
  ),
  candidatePool: z.array(z.object({ mechanism: z.string(), why: z.string() })),
  trimmed: z.array(z.object({ title: z.string(), reason: z.string().min(1) })),
});
export type GeneratorsFile = z.infer<typeof GeneratorsFile>;
