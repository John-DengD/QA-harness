/**
 * Anchor verification (spec §4.13): both sides are normalised the same way (whitespace collapsed,
 * Markdown marks and list/heading markers removed) and compared in the source's own language,
 * case-sensitively. A translation or paraphrase never matches.
 */
export function normalizeForAnchor(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, ""))
    .join(" ")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function anchorInSource(source: string, anchor: string): boolean {
  const a = normalizeForAnchor(anchor);
  if (a === "") return false;
  return normalizeForAnchor(source).includes(a);
}
