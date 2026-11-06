import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { ExitCode } from "./exit-codes";

export class RunbookError extends Error {
  readonly exitCode = ExitCode.CONFIG;
  constructor(message: string) {
    super(message);
    this.name = "RunbookError";
  }
}

export const REQUIRED_FILES = [
  "QA-models/_workflow/qa-environment.md",
  "QA-models/hellyeah/core-journeys.md",
  "references/case-design.md",
  "references/knowledge-sources.md",
  "references/verdicts.md",
] as const;

export type ModuleMeta = {
  id: string;
  path: string;
  status: "pilot" | "draft" | "active";
  version: number;
  lastReviewed: string;
};

export type Runbook = { root: string; modules: ModuleMeta[]; text(relPath: string): string };

const frontmatter = z.object({
  id: z.string().min(1),
  status: z.enum(["pilot", "draft", "active"]),
  version: z.number(),
  last_reviewed: z.union([z.string(), z.date()]),
});

const toDateString = (v: string | Date) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

export function loadRunbook(dir: string): Runbook {
  const root = path.resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new RunbookError(`runbook directory not found: ${root}`);
  }

  const problems: string[] = [];
  for (const rel of REQUIRED_FILES) {
    if (!existsSync(path.join(root, rel))) problems.push(`missing required file: ${rel}`);
  }

  const modules: ModuleMeta[] = [];
  const modDir = path.join(root, "QA-models/hellyeah");
  const files = existsSync(modDir) ? readdirSync(modDir).filter((f) => f.endsWith(".md")).sort() : [];
  for (const f of files) {
    const full = path.join(modDir, f);
    const rel = path.relative(root, full);
    let data: Record<string, unknown>;
    try {
      data = matter(readFileSync(full, "utf8")).data;
    } catch (e) {
      problems.push(`unreadable frontmatter in ${rel}: ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    if (Object.keys(data).length === 0) continue; // index.md, dashboard-routing.md: not modules
    const parsed = frontmatter.safeParse(data);
    if (!parsed.success) {
      const why = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      problems.push(`invalid frontmatter in ${rel}: ${why}`);
      continue;
    }
    const d = parsed.data;
    modules.push({ id: d.id, path: rel, status: d.status, version: d.version, lastReviewed: toDateString(d.last_reviewed) });
  }

  if (problems.length) throw new RunbookError(`runbook ${root} is invalid:\n- ${problems.join("\n- ")}`);

  return {
    root,
    modules,
    text(relPath: string) {
      const full = path.resolve(root, relPath);
      if (full !== root && !full.startsWith(root + path.sep)) {
        throw new RunbookError(`path escapes the runbook: ${relPath}`);
      }
      return readFileSync(full, "utf8");
    },
  };
}

/** pilot and draft modules cannot alone support ProductFail (spec §4.9). */
export function canSupportProductFail(m: ModuleMeta): boolean {
  return m.status === "active";
}
