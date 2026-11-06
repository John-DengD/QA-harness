import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ASSERTION_LOCK_FILE,
  assertionRowHash,
  loadAssertionRows,
  specAssertionRefs,
} from "../src/tools/assertion-refs";

// Run after reviewing a spec against the current QA-models assertions it cites:
// records each cited row as reviewed. Unknown IDs are refused, not locked.
const root = path.resolve(import.meta.dirname, "..");
const { rows, specs } = await loadAssertionRows(root);
const lock: Record<string, string> = {};
const unknown: string[] = [];
for (const spec of specs) {
  for (const id of specAssertionRefs(spec.text)) {
    const row = rows.get(id);
    if (row) lock[id] = assertionRowHash(row.row);
    else unknown.push(`${spec.file}: ${id}`);
  }
}
if (unknown.length) {
  console.error(`QA-models 中不存在的断言引用：\n${unknown.join("\n")}`);
  process.exit(2);
}
const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(path.join(root, ASSERTION_LOCK_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
console.log(JSON.stringify({ locked: Object.keys(sorted).length, file: ASSERTION_LOCK_FILE }));
