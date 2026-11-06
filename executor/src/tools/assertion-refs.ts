import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * A release spec may assert business Expected, but each assertion must cite the
 * QA module assertion it comes from (`@assert:WALLET-012` in the test tags), so
 * Expected keeps living in QA-models. The lock records each cited row as it was
 * when the spec was written: a changed row, or a module demoted to
 * needs-review, marks the citing spec as needing an update.
 */

export type AssertionRow = { file: string; status: string | null; row: string };
export type AssertionLock = Record<string, string>;
export type SpecSource = { file: string; text: string };

export const ASSERTION_LOCK_FILE = path.join("tests", "release", "assertion-refs.lock.json");

const ROW_ID = /^\|\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3})\s*\|/;

export function assertionRowHash(row: string): string {
  return createHash("sha256").update(row.trim().replace(/\s+/g, " ")).digest("hex").slice(0, 16);
}

export function collectAssertionRows(modules: readonly SpecSource[]): Map<string, AssertionRow> {
  const rows = new Map<string, AssertionRow>();
  for (const { file, text } of modules) {
    const status = /^status:\s*(\S+)/m.exec(text)?.[1] ?? null;
    for (const line of text.split("\n")) {
      const id = ROW_ID.exec(line)?.[1];
      if (id && !rows.has(id)) rows.set(id, { file, status, row: line });
    }
  }
  return rows;
}

export function specAssertionRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/@assert:([A-Z][A-Z0-9-]*-\d{3})\b/g)].map((match) => match[1]))];
}

/** Returns one readable problem per stale citation; empty means every cited assertion is current. */
export function checkSpecAssertionRefs(
  specs: readonly SpecSource[],
  rows: ReadonlyMap<string, AssertionRow>,
  lock: AssertionLock
): string[] {
  const problems: string[] = [];
  for (const spec of specs) {
    for (const id of specAssertionRefs(spec.text)) {
      const row = rows.get(id);
      if (!row) {
        problems.push(`${spec.file}: 引用的断言 ${id} 在 QA-models 中不存在`);
      } else if (row.status === "needs-review") {
        problems.push(`${spec.file}: 断言 ${id} 所在模块 ${row.file} 已降为 needs-review，spec 待更新`);
      } else if (!lock[id]) {
        problems.push(`${spec.file}: 断言 ${id} 未记录在锁文件，审过 spec 后运行 pnpm spec:assert-lock`);
      } else if (lock[id] !== assertionRowHash(row.row)) {
        problems.push(`${spec.file}: 断言 ${id} 在 ${row.file} 已修改，spec 待更新（更新后运行 pnpm spec:assert-lock）`);
      }
    }
  }
  return problems;
}

async function readTree(dir: string, suffix: string, base = dir): Promise<SpecSource[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: SpecSource[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await readTree(full, suffix, base));
    else if (entry.name.endsWith(suffix)) {
      out.push({ file: path.relative(base, full).replaceAll(path.sep, "/"), text: await readFile(full, "utf8") });
    }
  }
  return out;
}

/** `root` is hy_ui_autotest; QA-models sits next to it in the skill. */
export async function loadAssertionRows(root: string) {
  const modules = await readTree(path.resolve(root, "..", "QA-models"), ".md");
  const specs = await readTree(path.join(root, "tests", "release"), ".spec.ts");
  const lockText = await readFile(path.join(root, ASSERTION_LOCK_FILE), "utf8").catch(() => "{}");
  return { rows: collectAssertionRows(modules), specs, lock: JSON.parse(lockText) as AssertionLock };
}
