import { z } from "zod";

export const ChangeModel = z.object({
  surfaces: z.array(z.string()),
  entities: z.array(z.string()),
  transitions: z.array(z.object({ entity: z.string(), from: z.string(), to: z.string(), trigger: z.string() })),
  sideEffects: z.array(z.string()),
});
export type ChangeModel = z.infer<typeof ChangeModel>;
