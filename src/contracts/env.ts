import { z } from "zod";

export const Env = z.object({
  kind: z.enum(["pr-sandbox", "staging"]),
  baseUrl: z.string().url(),
  prNumber: z.number().int().optional(),
  headSha: z.string().optional(),
});
export type Env = z.infer<typeof Env>;
