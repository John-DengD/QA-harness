import { z } from "zod";

/** The original source texts, kept so later stages can verify anchors against them (spec §5). */
export const SourcesFile = z.object({ sources: z.array(z.object({ ref: z.string(), title: z.string(), text: z.string() })) });
export type SourcesFile = z.infer<typeof SourcesFile>;
