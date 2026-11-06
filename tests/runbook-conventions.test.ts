import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const ROOT = path.resolve(__dirname, "../runbook/QA-models");
const DIR = path.join(ROOT, "hellyeah");
const ROLES = ["observation", "risk", "authority", "user-confirmed", "timeline"];
const TABLE_HEADER = "| Ref | Source | Role | Status |";

type Doc = { file: string; text: string; data: Record<string, any>; body: string };
const docs: Doc[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((file) => {
    const text = readFileSync(path.join(DIR, file), "utf8");
    const m = matter(text);
    return { file, text, data: m.data, body: m.content };
  });
const modules = docs.filter((d) => d.data.type === "module");
const ids = new Set(docs.map((d) => d.data.id));

function sourceRows(d: Doc): string[][] | null {
  const lines = d.body.split("\n");
  const at = lines.findIndex((l) => l.startsWith("## 来源"));
  if (at < 0) return null;
  const rows: string[][] = [];
  let seenHeader = false;
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith("## ")) break;
    if (!l.startsWith("|")) continue;
    if (l.startsWith("| Ref ")) { expect(l.trim(), d.file).toBe(TABLE_HEADER); seenHeader = true; continue; }
    if (/^\|[-| ]+\|$/.test(l.trim())) continue;
    rows.push(l.split("|").slice(1, -1).map((c) => c.trim()));
  }
  expect(seenHeader, `${d.file} has no source table header`).toBe(true);
  return rows;
}

describe("runbook naming conventions", () => {
  it("every file under hellyeah/ has id = hellyeah.<filename>, a known type and product", () => {
    for (const d of docs) {
      expect(d.data.id, d.file).toBe(`hellyeah.${d.file.replace(/\.md$/, "")}`);
      expect(["module", "index", "routing"], d.file).toContain(d.data.type);
      expect(d.data.product, d.file).toBe("hellyeah");
    }
  });

  it("modules carry the full frontmatter and only link to existing modules", () => {
    expect(modules).toHaveLength(17);
    for (const d of modules) {
      expect(Array.isArray(d.data.surfaces) && d.data.surfaces.length > 0, `${d.file} surfaces`).toBe(true);
      expect(["pilot", "draft", "active"], d.file).toContain(d.data.status);
      expect(typeof d.data.version, d.file).toBe("number");
      expect(d.data.last_reviewed, d.file).toBeTruthy();
      expect(Array.isArray(d.data.related_modules), `${d.file} related_modules`).toBe(true);
      for (const r of d.data.related_modules) expect(ids.has(r), `${d.file} -> ${r}`).toBe(true);
    }
  });

  it("every title is 'English name（中文名）'", () => {
    for (const d of docs) {
      const title = d.body.split("\n").find((l) => l.startsWith("# "));
      expect(title, d.file).toMatch(/^# .+（.+）$/);
    }
  });

  it("source tables use one header, one ref format, contiguous numbering and the five roles", () => {
    let tables = 0;
    for (const d of modules) {
      const rows = sourceRows(d);
      if (!rows) continue;
      tables++;
      const prefixes = new Set(rows.map((r) => r[0]!.replace(/-S\d{2}$/, "")));
      expect(prefixes.size, `${d.file} mixes ref prefixes`).toBe(1);
      rows.forEach((r, i) => {
        expect(r, d.file).toHaveLength(4);
        expect(r[0], d.file).toMatch(/^[A-Z]+-S\d{2}$/);
        expect(r[0]!.endsWith(`-S${String(i + 1).padStart(2, "0")}`), `${d.file} ${r[0]} not contiguous`).toBe(true);
        expect(ROLES, `${d.file} ${r[0]}`).toContain(r[2]);
      });
    }
    expect(tables).toBe(16);
  });

  it("no old SRC-style refs remain, and every ref mentioned is defined somewhere", () => {
    const defined = new Set(modules.flatMap((d) => (sourceRows(d) ?? []).map((r) => r[0]!)));
    for (const d of docs) {
      expect(d.text, d.file).not.toMatch(/\b[A-Z]+-SRC-\d+/);
      for (const m of d.body.matchAll(/\b([A-Z]+-S\d{2})\b/g)) {
        expect(defined.has(m[1]!), `${d.file} mentions undefined ${m[1]}`).toBe(true);
      }
    }
  });

  it("modules use one of the two documented side-effect/bug section forms", () => {
    for (const d of modules.filter((m) => m.body.includes("## 来源"))) {
      const compact = d.body.includes("## 副作用、Bug 判断与回流");
      const full = d.body.includes("## 副作用与恢复") && d.body.includes("## Bug 判断知识");
      expect(compact || full, d.file).toBe(true);
      expect(compact && full, `${d.file} uses both forms`).toBe(false);
    }
  });

  it("the module list uses xray-* consistently", () => {
    const names = docs.map((d) => d.file);
    expect(names).toContain("xray-tracking.md");
    expect(names).not.toContain("tracking-xray.md");
    expect(JSON.stringify(docs.map((d) => d.text))).not.toContain("tracking-xray");
  });
});
