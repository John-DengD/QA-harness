import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** The linear-browser-qa skill directory (artifacts must never live here). */
export const skillDir = path.resolve(import.meta.dirname, "../../..");
export const defaultTmpRoots = ["/tmp", "/private/tmp"];

export const workbenchTemplate = "# QA 工作台\n\n所有需要人处理的事都在这里。规范、类型与映射表见 skill 内 `QA-Knowledge/qa-workbench.md`。\n\n## 必须处理\n\n## 让系统变强\n\n## 可选\n";
export const workbenchArchiveTemplate = "# QA 工作台归档\n\n已处理并映射完成的条目，只保留处理轨迹，不作为测试依据。\n";

export interface QaInitOptions {
  qaRoot: string;
  envFile: string;
  skillDir: string;
  save?: boolean;
  tmpRoots?: string[];
}

export interface QaInitResult {
  qaRoot: string;
  created: string[];
  kept: string[];
  saved: boolean;
}

function within(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Real path of the nearest existing ancestor, with the missing tail re-appended. */
function realish(target: string): string {
  let existing = target;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  try { return path.join(realpathSync(existing), ...tail); } catch { return target; }
}

export function assertAllowedQaRoot(qaRoot: string, skill: string, tmpRoots = defaultTmpRoots): void {
  const candidates = [qaRoot, realish(qaRoot)];
  const skillCandidates = [skill, realish(skill)];
  if (candidates.some((candidate) => skillCandidates.some((dir) => within(candidate, dir)))) {
    throw new Error(`QA_ROOT ${qaRoot} is inside the skill directory ${skill}; test artifacts must live outside the skill.`);
  }
  const tmpCandidates = tmpRoots.flatMap((dir) => [dir, realish(dir)]);
  if (candidates.some((candidate) => tmpCandidates.some((dir) => within(candidate, dir)))) {
    throw new Error(`QA_ROOT ${qaRoot} is inside /tmp; test artifacts must live in a persistent directory.`);
  }
}

function formatValue(value: string): string {
  if (!/[\s#"'`\\$]/.test(value)) return value;
  if (value.includes("'")) throw new Error(`Cannot store a QA_ROOT containing a single quote: ${value}`);
  return `'${value}'`;
}

const qaRootLine = /^\s*(?:export\s+)?QA_ROOT\s*=/;

/** Replace every QA_ROOT line (keeping its line ending) or append one; other lines are untouched. */
export function upsertQaRootLine(content: string, qaRoot: string): string {
  const line = `QA_ROOT=${formatValue(qaRoot)}`;
  const parts = content.split(/(?<=\n)/);
  let replaced = false;
  const updated = parts.map((part) => {
    if (!qaRootLine.test(part)) return part;
    replaced = true;
    const ending = /\r?\n$/.exec(part)?.[0] ?? "";
    return `${line}${ending}`;
  });
  if (replaced) return updated.join("");
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${line}\n`;
}

async function saveQaRoot(envFile: string, qaRoot: string): Promise<void> {
  if (!existsSync(envFile)) {
    await writeFile(envFile, upsertQaRootLine("", qaRoot), { mode: 0o600, flag: "wx" });
    return;
  }
  const content = await readFile(envFile, "utf8");
  const next = upsertQaRootLine(content, qaRoot);
  if (next !== content) await writeFile(envFile, next);
}

export async function initQaRoot(options: QaInitOptions): Promise<QaInitResult> {
  const qaRoot = path.resolve(options.qaRoot);
  assertAllowedQaRoot(qaRoot, path.resolve(options.skillDir), options.tmpRoots);
  const created: string[] = [];
  const kept: string[] = [];
  for (const dir of [".", ".qa-loop"]) {
    const target = path.join(qaRoot, dir);
    if (existsSync(target)) {
      if (!(await stat(target)).isDirectory()) throw new Error(`${target} exists and is not a directory`);
      kept.push(dir);
    } else {
      await mkdir(target, { recursive: true });
      created.push(dir);
    }
  }
  for (const [name, content] of [["qa-workbench.md", workbenchTemplate], ["qa-workbench-archive.md", workbenchArchiveTemplate]]) {
    const target = path.join(qaRoot, name);
    if (existsSync(target)) { kept.push(name); continue; }
    await writeFile(target, content, { flag: "wx" });
    created.push(name);
  }
  if (options.save) await saveQaRoot(options.envFile, qaRoot);
  return { qaRoot, created, kept, saved: Boolean(options.save) };
}
