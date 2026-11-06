import { z } from "zod";

/** What `qa extract` dropped and why (spec §12: un-anchored atoms are not written, the reason is recorded). */
export const ExtractReport = z.object({
  dropped: z.array(z.object({ text: z.string(), sourceRef: z.string(), anchor: z.string(), reason: z.string() })),
  sources: z.array(z.object({ ref: z.string(), title: z.string() })),
});
export type ExtractReport = z.infer<typeof ExtractReport>;
