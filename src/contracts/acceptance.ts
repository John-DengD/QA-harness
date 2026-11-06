import { z } from "zod";

/** Every atom carries its source and a verbatim anchor; code/diff alone cannot be an Expected source (spec §5). */
export const Atom = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceRef: z.string().min(1),
  anchor: z.string().min(1),
});
export const Acceptance = z.object({ atoms: z.array(Atom) });
export type Acceptance = z.infer<typeof Acceptance>;
