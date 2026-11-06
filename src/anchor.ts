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

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
/** Short anchors match almost any source; require a meaningful fragment (10+ characters, or 6+ when CJK). */
export function anchorLongEnough(normalized: string): boolean {
  return normalized.length >= (CJK.test(normalized) ? 6 : 10);
}

export function anchorInSource(source: string, anchor: string): boolean {
  const a = normalizeForAnchor(anchor);
  if (a === "" || !anchorLongEnough(a)) return false;
  return normalizeForAnchor(source).includes(a);
}
