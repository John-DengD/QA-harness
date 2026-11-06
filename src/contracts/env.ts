import { z } from "zod";

export const Env = z.object({
  kind: z.enum(["pr-sandbox", "staging"]),
  baseUrl: z.string().url(),
  prNumber: z.number().int().optional(),
  headSha: z.string().optional(),
  adminUrl: z.string().url().optional(),
  apiUrl: z.string().url().optional(),
});
export type Env = z.infer<typeof Env>;
