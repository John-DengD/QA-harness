import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import type { ExportNamedDeclaration, ImportDeclaration, Statement } from "@babel/types";

import { actionsFromSource, type ActionEntry } from "./action-index";
import {
  readActionHealth, recordFirstSeen, recordLastUsed, removeActionHealthRecords, stampFirstSeen, type ActionHealthFile,
} from "./action-health";
import type { ActionTable, ActionTableEntry } from "./action-table";

/**
 * Library hygiene: Actions that keep failing or that nobody used for a month are
 * removed, with an archive line that can put them back.
 *
 * - unhealthy: consecutiveFailures >= 3, or an open script_drift followup older than 14 days;
 * - stale: firstSeen older than 30 days and no trusted use (lastUsed, else firstSeen) within 30 days.
 *   An Action without a health record is stamped firstSeen=now first, so its clock starts today.
 *
 * A candidate is kept (stale_protected / unhealthy_protected) when its row is pinned,
 * another row names it in undoneBy, or its name is referenced anywhere in src/, tests/,
 * scripts/ other than its own declaration, the catalog, its own dedicated unit tests and
 * its shared-execution denylist key.
 */
export const UNHEALTHY_FAILURES = 3;
export const FOLLOWUP_MAX_DAYS = 14;
export const STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const CATALOG_FILE = "src/tools/action-catalog.json";
const DENYLIST_FILE = "src/tools/shared-action-policy.ts";
/** Generated indexes that are rebuilt from the source; a name in them is not a reference. None at present. */
const GENERATED_INDEX_FILES = new Set<string>();
const SCAN_DIRS = ["src", "tests", "scripts"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"]);

export type PruneReason = "unhealthy" | "stale";
export type PruneDeletion = {
  action: string; file: string; reason: PruneReason; detail: string; since: string; dedicatedTests: string[];
};
export type PruneProtected = {
  action: string; file: string | null; status: "stale_protected" | "unhealthy_protected";
  reason: string; since: string | null; references?: string[];
};
export type PrunePlan = { now: string; stamped: string[]; deletions: PruneDeletion[]; protected: PruneProtected[] };

type ScriptDriftFollowup = { action: string; createdAt: string };

function wordPattern(name: string): RegExp {
  return new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$")}(?![\\w$])`, "g");
}

function count(text: string, name: string): number {
  return [...text.matchAll(wordPattern(name))].length;
}

async function listFiles(root: string, relative: string): Promise<string[]> {
  const out: string[] = [];
  let names;
  try {
    names = await readdir(path.join(root, relative), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of names) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(root, child));
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(child);
  }
  return out;
}

async function openScriptDriftFollowups(qaRoot: string): Promise<ScriptDriftFollowup[]> {
  const directory = path.join(qaRoot, ".qa-loop", "followups");
  let files: string[];
  try {
    files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const out: ScriptDriftFollowup[] = [];
  for (const name of files) {
    try {
      const gap = JSON.parse(await readFile(path.join(directory, name), "utf8")) as Record<string, unknown>;
      if (gap.kind !== "script_drift" || (gap.status !== "open" && gap.status !== "claimed")) continue;
      const key = String(gap.mechanismKey ?? "");
      if (!key.startsWith("script-drift.") || typeof gap.createdAt !== "string") continue;
      out.push({ action: key.slice("script-drift.".length), createdAt: gap.createdAt });
    } catch { /* unreadable followup: ignore */ }
  }
  return out;
}

/** The exported declaration of `name`: its removable range (leading JSDoc included) or why it cannot be removed. */
export function locateDeclaration(source: string, name: string):
  { start: number; end: number; declStart: number } | { error: string } {
  const program = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }).program;
  for (const statement of program.body as Statement[]) {
    if (statement.type !== "ExportNamedDeclaration" || !statement.declaration) continue;
    const declaration = (statement as ExportNamedDeclaration).declaration!;
    let found = false;
    if (declaration.type === "FunctionDeclaration" && declaration.id?.name === name) found = true;
    if (declaration.type === "VariableDeclaration" &&
        declaration.declarations.some((item) => item.id.type === "Identifier" && item.id.name === name)) {
      if (declaration.declarations.length !== 1) return { error: "declared together with other variables" };
      found = true;
    }
    if (!found) continue;
    let start = statement.start!;
    const comment = statement.leadingComments?.at(-1);
    if (comment && comment.type === "CommentBlock" && comment.value.startsWith("*") &&
        !source.slice(comment.end!, start).trim()) start = comment.start!;
    return { start, end: statement.end!, declStart: statement.start! };
  }
  return { error: "exported declaration not found" };
}

function cutRange(text: string, start: number, end: number): string {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const from = text.slice(lineStart, start).trim() ? start : lineStart;
  const to = text[end] === "\n" ? end + 1 : end;
  let out = text.slice(0, from) + text.slice(to);
  // Do not leave two blank lines where the declaration was.
  if (out.slice(Math.max(0, from - 2), from) === "\n\n" && out[from] === "\n") out = out.slice(0, from) + out.slice(from + 1);
  return out;
}

/** Drops import specifiers used only by the removed text, when the import is a plain single-line named import. */
export function dropUnusedImports(text: string, removed: string): string {
  const program = parse(text, { sourceType: "module", plugins: ["typescript", "jsx"] }).program;
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const statement of program.body as Statement[]) {
    if (statement.type !== "ImportDeclaration") continue;
    const declaration = statement as ImportDeclaration;
    const original = text.slice(declaration.start!, declaration.end!);
    if (original.includes("\n") || !declaration.specifiers.length ||
        declaration.specifiers.some((specifier) => specifier.type !== "ImportSpecifier")) continue;
    const outside = text.slice(0, declaration.start!) + text.slice(declaration.end!);
    const kept = declaration.specifiers.filter((specifier) => {
      const local = specifier.local.name;
      return count(removed, local) === 0 || count(outside, local) > 0;
    });
    if (kept.length === declaration.specifiers.length) continue;
    if (!kept.length) {
      edits.push({ start: declaration.start!, end: declaration.end!, replacement: "" });
      continue;
    }
    const open = original.indexOf("{");
    const close = original.lastIndexOf("}");
    if (open < 0 || close < open) continue;
    const inner = kept.map((specifier) => text.slice(specifier.start!, specifier.end!)).join(", ");
    edits.push({ start: declaration.start!, end: declaration.end!,
      replacement: `${original.slice(0, open)}{ ${inner} }${original.slice(close + 1)}` });
  }
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = edit.replacement ? out.slice(0, edit.start) + edit.replacement + out.slice(edit.end) : cutRange(out, edit.start, edit.end);
  }
  return out;
}

/** Removes one top-level row from the catalog text, keeping every other row's formatting. */
export function removeCatalogRow(text: string, name: string): string {
  const table = JSON.parse(text) as Record<string, unknown>;
  const expected = { ...table };
  delete expected[name];
  const fallback = `${JSON.stringify(expected, null, 2)}\n`;
  const keyAt = text.indexOf(`\n  ${JSON.stringify(name)}:`);
  if (keyAt < 0) return fallback;
  let index = text.indexOf("{", keyAt + name.length + 4);
  let depth = 0;
  let inString = false;
  for (; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === "\"") inString = false;
    } else if (char === "\"") inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const valueEnd = index + 1;
  let out: string;
  if (text[valueEnd] === ",") {
    out = text.slice(0, keyAt) + text.slice(valueEnd + 1);
  } else {
    const comma = text.lastIndexOf(",", keyAt);
    out = comma >= 0 && !text.slice(comma + 1, keyAt).trim() ? text.slice(0, comma) + text.slice(valueEnd) : "";
  }
  try {
    if (out && JSON.stringify(JSON.parse(out)) === JSON.stringify(expected)) return out;
  } catch { /* fall back */ }
  return fallback;
}

/** Removes the `name: "...",` key line from SHARED_ACTION_DENYLIST, when it is a single line. */
function removeDenylistKey(text: string, name: string): string {
  return text.replace(new RegExp(`^  ${name}: [^\\n]*,\\n`, "m"), "");
}

function relativeImportNames(source: string): Set<string> | null {
  try {
    const program = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }).program;
    const names = new Set<string>();
    for (const statement of program.body as Statement[]) {
      if (statement.type !== "ImportDeclaration") continue;
      const declaration = statement as ImportDeclaration;
      if (!declaration.source.value.startsWith(".") || declaration.importKind === "type") continue;
      for (const specifier of declaration.specifiers) {
        if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
        names.add(specifier.local.name);
      }
    }
    return names;
  } catch {
    return null;
  }
}

type ReferenceScan = { references: string[]; dedicatedTests: string[] };

function scanReferences(name: string, entry: ActionEntry, files: ReadonlyMap<string, string>, actionNames: readonly string[]): ReferenceScan {
  const references: string[] = [];
  const dedicatedTests: string[] = [];
  const others = actionNames.filter((other) => other !== name);
  for (const [file, text] of files) {
    if (file === CATALOG_FILE || GENERATED_INDEX_FILES.has(file) || !count(text, name)) continue;
    if (file === entry.file) {
      const range = locateDeclaration(text, name);
      if ("error" in range) { references.push(file); continue; }
      if (count(text.slice(0, range.start) + text.slice(range.end), name)) references.push(file);
      continue;
    }
    if (file === DENYLIST_FILE) {
      if (count(removeDenylistKey(text, name), name)) references.push(file);
      continue;
    }
    if (file.startsWith("tests/") && /\.test\.tsx?$/.test(file)) {
      const imports = relativeImportNames(text);
      const dedicated = imports !== null && imports.size === 1 && imports.has(name) &&
        !others.some((other) => count(text, other) > 0);
      (dedicated ? dedicatedTests : references).push(file);
      continue;
    }
    references.push(file);
  }
  return { references: references.sort(), dedicatedTests: dedicatedTests.sort() };
}

function olderThan(iso: string | null | undefined, now: Date, days: number): boolean {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) && now.getTime() - at > days * DAY_MS;
}

async function libraryEntries(skillRoot: string): Promise<ActionEntry[]> {
  const files = (await readdir(path.join(skillRoot, "src/actions"))).filter((name) => name.endsWith("-actions.ts"));
  return (await Promise.all(files.map(async (name) => {
    const file = `src/actions/${name}`;
    return actionsFromSource(await readFile(path.join(skillRoot, file), "utf8"), file).map((entry) => ({ ...entry, hot: false }));
  }))).flat();
}

export function pruneCandidate(name: string, health: ActionHealthFile, followups: readonly ScriptDriftFollowup[], now: Date):
  { reason: PruneReason; detail: string; since: string } | null {
  const record = health.actions[name];
  if (record && record.consecutiveFailures >= UNHEALTHY_FAILURES) {
    return { reason: "unhealthy", detail: `consecutiveFailures ${record.consecutiveFailures}`,
      since: record.lastFailure?.at ?? recordFirstSeen(record) ?? now.toISOString() };
  }
  const followup = followups.filter((item) => item.action === name && olderThan(item.createdAt, now, FOLLOWUP_MAX_DAYS))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (followup) return { reason: "unhealthy", detail: `script_drift followup open > ${FOLLOWUP_MAX_DAYS} days`, since: followup.createdAt };
  const firstSeen = recordFirstSeen(record);
  const lastUsed = recordLastUsed(record);
  if (firstSeen && olderThan(firstSeen, now, STALE_DAYS) && olderThan(lastUsed ?? firstSeen, now, STALE_DAYS)) {
    return { reason: "stale", detail: `no trusted use in ${STALE_DAYS} days`, since: lastUsed ?? firstSeen };
  }
  return null;
}

export async function planPrune(input: { skillRoot: string; qaRoot: string; now?: Date }): Promise<PrunePlan> {
  const now = input.now ?? new Date();
  const catalog = JSON.parse(await readFile(path.join(input.skillRoot, CATALOG_FILE), "utf8")) as ActionTable;
  const names = Object.keys(catalog);
  const stamped = await stampFirstSeen(input.qaRoot, names, now);
  const health = await readActionHealth(input.qaRoot);
  const followups = await openScriptDriftFollowups(input.qaRoot);
  const entries = new Map((await libraryEntries(input.skillRoot)).map((entry) => [entry.name, entry]));
  const files = new Map<string, string>();
  for (const directory of SCAN_DIRS) {
    for (const file of await listFiles(input.skillRoot, directory)) files.set(file, await readFile(path.join(input.skillRoot, file), "utf8"));
  }
  const plan: PrunePlan = { now: now.toISOString(), stamped, deletions: [], protected: [] };
  for (const name of names) {
    const candidate = pruneCandidate(name, health, followups, now);
    if (!candidate) continue;
    const status = candidate.reason === "stale" ? "stale_protected" as const : "unhealthy_protected" as const;
    const entry = entries.get(name);
    const keep = (reason: string, references?: string[]) => plan.protected.push({
      action: name, file: entry?.file ?? null, status, reason, since: candidate.since, ...(references ? { references } : {}),
    });
    if (catalog[name].pinned === true) { keep("pinned"); continue; }
    const undoer = names.find((other) => other !== name && catalog[other].undoneBy === name);
    if (undoer) { keep(`undone_by:${undoer}`); continue; }
    if (!entry) { keep("not_an_exported_action"); continue; }
    const located = locateDeclaration(files.get(entry.file) ?? "", name);
    if ("error" in located) { keep(`unsure_declaration: ${located.error}`); continue; }
    const scan = scanReferences(name, entry, files, names);
    if (scan.references.length) { keep("referenced", scan.references); continue; }
    plan.deletions.push({ action: name, file: entry.file, ...candidate, dedicatedTests: scan.dedicatedTests });
  }
  return plan;
}

export type PruneChecks = (skillRoot: string) => Promise<{ ok: boolean; output: string }>;

/** `npx tsc --noEmit -p .` then the unit tests, in the skill root. */
export const defaultPruneChecks: PruneChecks = async (skillRoot) => {
  for (const [command, args] of [["npx", ["tsc", "--noEmit", "-p", "."]], ["pnpm", ["-s", "test:unit"]]] as const) {
    const result = spawnSync(command, [...args], { cwd: skillRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) {
      return { ok: false, output: `${command} ${args.join(" ")}:\n${`${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n")}` };
    }
  }
  return { ok: true, output: "" };
};

export type PruneArchiveLine = {
  at: string; action: string; file: string; reason: PruneReason; since: string; codeHash: string;
  removedSource: string; catalogRow: ActionTableEntry; removedTests: Array<{ file: string; content: string }>;
};

/**
 * Deletes the planned Actions, then typechecks and runs the unit tests. On any
 * failure every touched file is restored and the Actions are reported protected
 * (build_or_tests_fail); on success their health records go and one archive line
 * per deletion is appended to QA_ROOT/.qa-loop/action-prune.jsonl.
 */
export async function applyPrune(input: {
  skillRoot: string; qaRoot: string; plan: PrunePlan; now?: Date; runChecks?: PruneChecks;
}): Promise<{ deleted: PruneArchiveLine[]; protected: PruneProtected[]; checks: { ok: boolean; output: string } | null }> {
  const now = input.now ?? new Date();
  const runChecks = input.runChecks ?? defaultPruneChecks;
  const originals = new Map<string, string>();
  const current = new Map<string, string | null>();
  const read = async (file: string): Promise<string> => {
    if (!current.has(file)) {
      const text = await readFile(path.join(input.skillRoot, file), "utf8");
      originals.set(file, text);
      current.set(file, text);
    }
    return current.get(file)!;
  };
  const protectedOut: PruneProtected[] = [...input.plan.protected];
  const pending: PruneArchiveLine[] = [];
  for (const deletion of input.plan.deletions) {
    const keep = (reason: string) => protectedOut.push({ action: deletion.action, file: deletion.file,
      status: deletion.reason === "stale" ? "stale_protected" : "unhealthy_protected", reason, since: deletion.since });
    const source = await read(deletion.file);
    const located = locateDeclaration(source, deletion.action);
    if ("error" in located) { keep(`unsure_declaration: ${located.error}`); continue; }
    const codeHash = createHash("sha256").update(originals.get(deletion.file)!).digest("hex").slice(0, 12);
    const removedSource = source.slice(located.start, located.end);
    current.set(deletion.file, dropUnusedImports(cutRange(source, located.start, located.end), removedSource));
    const catalogText = await read(CATALOG_FILE);
    const catalogRow = (JSON.parse(catalogText) as ActionTable)[deletion.action];
    current.set(CATALOG_FILE, removeCatalogRow(catalogText, deletion.action));
    try {
      const policy = await read(DENYLIST_FILE);
      current.set(DENYLIST_FILE, removeDenylistKey(policy, deletion.action));
    } catch { /* no policy file */ }
    const removedTests: Array<{ file: string; content: string }> = [];
    for (const file of deletion.dedicatedTests) {
      removedTests.push({ file, content: await read(file) });
      current.set(file, null);
    }
    pending.push({ at: now.toISOString(), action: deletion.action, file: deletion.file, reason: deletion.reason,
      since: deletion.since, codeHash, removedSource, catalogRow, removedTests });
  }
  if (!pending.length) return { deleted: [], protected: protectedOut, checks: null };

  const restore = async () => {
    for (const [file, text] of originals) await writeFile(path.join(input.skillRoot, file), text);
  };
  let checks: { ok: boolean; output: string };
  try {
    for (const [file, text] of current) {
      if (text === originals.get(file)) continue;
      if (text === null) await rm(path.join(input.skillRoot, file), { force: true });
      else await writeFile(path.join(input.skillRoot, file), text);
    }
    checks = await runChecks(input.skillRoot);
  } catch (error) {
    checks = { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
  if (!checks.ok) {
    await restore();
    for (const line of pending) {
      protectedOut.push({ action: line.action, file: line.file,
        status: line.reason === "stale" ? "stale_protected" : "unhealthy_protected", reason: "build_or_tests_fail", since: line.since });
    }
    return { deleted: [], protected: protectedOut, checks };
  }
  await removeActionHealthRecords(input.qaRoot, pending.map((line) => line.action));
  const archive = path.join(input.qaRoot, ".qa-loop", "action-prune.jsonl");
  await mkdir(path.dirname(archive), { recursive: true });
  await appendFile(archive, pending.map((line) => `${JSON.stringify(line)}\n`).join(""));
  return { deleted: pending, protected: protectedOut, checks };
}
