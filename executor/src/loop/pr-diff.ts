import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { checkedOutputPath, checkedPath } from "./checker";

const exec = promisify(execFile);
const fullSha = /^[0-9a-f]{40}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const changeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const statusPattern = /^([AMDRCT])(?:\d{1,3})?$/;

export type PrDiffIdentity = { repository: string; baseSha: string; headSha: string };
export type PrChangedFile = {
  filePath: string;
  status: "A" | "M" | "D" | "R" | "C" | "T";
  oldPath?: string;
  changeId?: string;
  excludedReason?: string;
};
export type PrDiffInventory = PrDiffIdentity & { schemaVersion: 1; changedFiles: PrChangedFile[] };
export type PrDiffClassification = { filePath: string; changeId?: string; excludedReason?: string };

function object(value: unknown, label: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const entry = value as Record<string, unknown>;
  const extra = Object.keys(entry).filter((key) => !keys.includes(key));
  if (extra.length) throw new Error(`${label} has unexpected fields: ${extra.join(", ")}`);
  return entry;
}

function repository(value: unknown): string {
  if (typeof value !== "string" || !repositoryPattern.test(value) || value.includes("..")) {
    throw new Error("repository must be an owner/repo slug");
  }
  return value.toLowerCase();
}

function sha(value: unknown, label: string): string {
  if (typeof value !== "string" || !fullSha.test(value)) throw new Error(`${label} must be a full 40-character commit SHA`);
  return value;
}

function repoFile(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\") ||
      path.posix.isAbsolute(value) || value.split("/").some((part) => !part || part === "." || part === "..") ||
      path.posix.normalize(value) !== value) throw new Error(`${label} must be a clean repository-relative path`);
  return value;
}

function optionalClassification(value: Record<string, unknown>, label: string): Pick<PrChangedFile, "changeId" | "excludedReason"> {
  const { changeId, excludedReason } = value;
  if (changeId !== undefined && excludedReason !== undefined) throw new Error(`${label} cannot have both changeId and excludedReason`);
  if (changeId !== undefined && (typeof changeId !== "string" || !changeIdPattern.test(changeId))) {
    throw new Error(`${label}.changeId must be a short identifier`);
  }
  if (excludedReason !== undefined && (typeof excludedReason !== "string" || !excludedReason.trim() ||
      excludedReason.length > 500 || /[\x00-\x1f]/.test(excludedReason))) {
    throw new Error(`${label}.excludedReason must be a short, printable reason`);
  }
  return {
    ...(changeId === undefined ? {} : { changeId }),
    ...(excludedReason === undefined ? {} : { excludedReason: (excludedReason as string).trim() }),
  };
}

function sortFiles(files: PrChangedFile[]): PrChangedFile[] {
  return files.sort((a, b) => a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0);
}

export function validatePrDiffInventoryShape(value: unknown): PrDiffInventory {
  const entry = object(value, "PR inventory", ["schemaVersion", "repository", "baseSha", "headSha", "changedFiles"]);
  if (entry.schemaVersion !== 1 || !Array.isArray(entry.changedFiles)) throw new Error("Unsupported PR inventory schema");
  const changedFiles: PrChangedFile[] = entry.changedFiles.map((raw, index) => {
    const item = object(raw, `changedFiles[${index}]`, ["filePath", "status", "oldPath", "changeId", "excludedReason"]);
    const filePath = repoFile(item.filePath, `changedFiles[${index}].filePath`);
    if (!["A", "M", "D", "R", "C", "T"].includes(item.status as string)) throw new Error(`Unsupported status for ${filePath}`);
    const status = item.status as PrChangedFile["status"];
    if ((status === "R" || status === "C") !== (item.oldPath !== undefined)) {
      throw new Error(`${filePath}: rename/copy status must include oldPath`);
    }
    const oldPath = item.oldPath === undefined ? undefined : repoFile(item.oldPath, `${filePath}.oldPath`);
    return { filePath, status, ...(oldPath ? { oldPath } : {}), ...optionalClassification(item, filePath) };
  });
  if (new Set(changedFiles.map((file) => file.filePath)).size !== changedFiles.length) {
    throw new Error("PR inventory repeats a changed file");
  }
  if (changedFiles.some((file, index) => index > 0 && changedFiles[index - 1].filePath >= file.filePath)) {
    throw new Error("PR inventory files must be sorted by filePath");
  }
  const baseSha = sha(entry.baseSha, "baseSha");
  const headSha = sha(entry.headSha, "headSha");
  if (baseSha === headSha) throw new Error("PR inventory needs distinct base and head commits");
  return { schemaVersion: 1, repository: repository(entry.repository), baseSha, headSha, changedFiles };
}

function parseOrigin(value: string): string {
  const origin = value.trim();
  const match = origin.match(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (!match) throw new Error("Product repo origin must be a GitHub owner/repo URL");
  return repository(`${match[1]}/${match[2]}`);
}

async function git(repoPath: string, args: string[]): Promise<Buffer> {
  const { stdout } = await exec("git", ["-C", repoPath, ...args], {
    encoding: "buffer", timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return stdout as Buffer;
}

function text(buffer: Buffer): string {
  const decoded = buffer.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(buffer)) throw new Error("Git returned a non-UTF-8 path or value");
  return decoded.trim();
}

async function checkedRepository(repoPath: string, identity: PrDiffIdentity): Promise<string> {
  const resolved = await realpath(repoPath);
  const top = await realpath(text(await git(resolved, ["rev-parse", "--show-toplevel"])));
  if (resolved !== top) throw new Error("--repo must point to the product Git worktree root");
  if (parseOrigin(text(await git(resolved, ["remote", "get-url", "origin"]))) !== repository(identity.repository)) {
    throw new Error("Product repo origin does not match the requested PR repository");
  }
  for (const [label, commit] of [["baseSha", identity.baseSha], ["headSha", identity.headSha]] as const) {
    const resolvedCommit = text(await git(resolved, ["rev-parse", "--verify", `${sha(commit, label)}^{commit}`]));
    if (resolvedCommit !== commit) throw new Error(`${label} is not an exact commit in the product repo`);
  }
  return resolved;
}

function fields(buffer: Buffer): string[] {
  if (!buffer.length) return [];
  if (buffer[buffer.length - 1] !== 0) throw new Error("Malformed NUL-delimited Git diff");
  const values = buffer.subarray(0, -1).toString("utf8").split("\0");
  if (!Buffer.from(`${values.join("\0")}\0`, "utf8").equals(buffer)) throw new Error("Git diff contains a non-UTF-8 path");
  return values;
}

async function changedFiles(repoPath: string, identity: PrDiffIdentity): Promise<PrChangedFile[]> {
  const parts = fields(await git(repoPath, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z",
    "--find-renames", "--find-copies", identity.baseSha, identity.headSha, "--"]));
  const changes: PrChangedFile[] = [];
  for (let index = 0; index < parts.length;) {
    const marker = parts[index++];
    const match = marker.match(statusPattern);
    if (!match) throw new Error(`Unexpected Git diff status: ${marker}`);
    const status = match[1] as PrChangedFile["status"];
    if (status === "R" || status === "C") {
      if (index + 1 >= parts.length) throw new Error("Truncated rename/copy in Git diff");
      const oldPath = repoFile(parts[index++], "oldPath");
      changes.push({ filePath: repoFile(parts[index++], "filePath"), status, oldPath });
    } else {
      if (index >= parts.length) throw new Error("Truncated Git diff");
      changes.push({ filePath: repoFile(parts[index++], "filePath"), status });
    }
  }
  return sortFiles(changes);
}

async function atomicCreate(qaRoot: string, outputRef: string, inventory: PrDiffInventory): Promise<void> {
  const output = await checkedOutputPath(qaRoot, outputRef);
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(inventory, null, 2)}\n`, { flag: "wx" });
    await link(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function createPrDiffInventory(qaRoot: string, repoPath: string, outputRef: string,
  identity: PrDiffIdentity): Promise<PrDiffInventory> {
  const normalized = validatePrDiffInventoryShape({ schemaVersion: 1, ...identity, changedFiles: [] });
  const repo = await checkedRepository(repoPath, normalized);
  const inventory = { ...normalized, changedFiles: await changedFiles(repo, normalized) };
  await atomicCreate(qaRoot, outputRef, inventory);
  return inventory;
}

export async function verifyPrDiffInventory(qaRoot: string, repoPath: string, inventoryRef: string,
  identity: PrDiffIdentity): Promise<{ valid: true; repository: string; baseSha: string; headSha: string;
  changedFiles: number; classifiedFiles: number; excludedFiles: number; unclassifiedFiles: number }> {
  const parsed = validatePrDiffInventoryShape(JSON.parse(await readFile(await checkedPath(qaRoot, inventoryRef), "utf8")));
  const expected = validatePrDiffInventoryShape({ schemaVersion: 1, ...identity, changedFiles: [] });
  if (parsed.repository !== expected.repository || parsed.baseSha !== expected.baseSha || parsed.headSha !== expected.headSha) {
    throw new Error("PR inventory repository/base/head differs from the requested PR");
  }
  const repo = await checkedRepository(repoPath, expected);
  const actual = await changedFiles(repo, expected);
  const mapped = parsed.changedFiles.map(({ filePath, status, oldPath }) => ({ filePath, status, ...(oldPath ? { oldPath } : {}) }));
  if (JSON.stringify(mapped) !== JSON.stringify(actual)) throw new Error("PR inventory omits or changes a file/status from the exact Git diff");
  const classifiedFiles = parsed.changedFiles.filter((file) => file.changeId !== undefined).length;
  const excludedFiles = parsed.changedFiles.filter((file) => file.excludedReason !== undefined).length;
  return { valid: true, repository: parsed.repository, baseSha: parsed.baseSha, headSha: parsed.headSha,
    changedFiles: actual.length, classifiedFiles, excludedFiles,
    unclassifiedFiles: actual.length - classifiedFiles - excludedFiles };
}

export async function classifyPrDiffInventory(qaRoot: string, repoPath: string, inputRef: string,
  outputRef: string, identity: PrDiffIdentity, classifications: unknown): Promise<PrDiffInventory> {
  await verifyPrDiffInventory(qaRoot, repoPath, inputRef, identity);
  const inventory = validatePrDiffInventoryShape(JSON.parse(await readFile(await checkedPath(qaRoot, inputRef), "utf8")));
  if (!Array.isArray(classifications)) throw new Error("Classifications must be an array");
  const entries = classifications.map((raw, index) => {
    const entry = object(raw, `classifications[${index}]`, ["filePath", "changeId", "excludedReason"]);
    return { filePath: repoFile(entry.filePath, `classifications[${index}].filePath`),
      ...optionalClassification(entry, `classifications[${index}]`) };
  });
  if (entries.length !== inventory.changedFiles.length || new Set(entries.map((item) => item.filePath)).size !== entries.length) {
    throw new Error("Classifications must cover every changed file exactly once");
  }
  const byFile = new Map(entries.map((entry) => [entry.filePath, entry]));
  const changed = inventory.changedFiles.map((item) => {
    const classification = byFile.get(item.filePath);
    if (!classification || (!classification.changeId && !classification.excludedReason)) {
      throw new Error(`Changed file lacks changeId or excludedReason: ${item.filePath}`);
    }
    return { filePath: item.filePath, status: item.status, ...(item.oldPath ? { oldPath: item.oldPath } : {}),
      ...optionalClassification(classification, item.filePath) };
  });
  const result = { ...inventory, changedFiles: changed };
  await atomicCreate(qaRoot, outputRef, result);
  return result;
}
