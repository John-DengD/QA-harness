import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { ConfigError } from "./config";
import { Acceptance } from "./contracts/acceptance";
import { CaseReviewFile, CasesReviewedFile } from "./contracts/case-review";
import { CasesFile } from "./contracts/cases";
import { ChangeModel } from "./contracts/change-model";
import { Env } from "./contracts/env";
import { GeneratorsFile } from "./contracts/generators";
import { CaseResult } from "./contracts/result";

const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;

export function createRunDir(runRoot: string, feature: string, runId: string, opts: { force: boolean }): string {
  for (const [label, v] of [["feature", feature], ["runId", runId]] as const) {
    if (!SEGMENT.test(v) || v.includes("..")) throw new ConfigError(`invalid ${label}: ${JSON.stringify(v)}`);
  }
  const dir = path.join(runRoot, feature, "runs", runId);
  if (existsSync(dir) && !opts.force) {
    throw new ConfigError(`run directory already exists (use --force to reuse): ${dir}`);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

const REGISTRY: Record<string, ZodType> = {
  "acceptance.json": Acceptance,
  "change-model.json": ChangeModel,
  "env.json": Env,
  "cases.json": CasesFile,
  "generators.json": GeneratorsFile,
  "case-review.json": CaseReviewFile,
  "cases.reviewed.json": CasesReviewedFile,
};

function schemaFor(name: string): ZodType {
  const fixed = REGISTRY[name];
  if (fixed) return fixed;
  if (/^results\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(name)) return CaseResult;
  throw new Error(`unknown artifact: ${name}`);
}

/** Validates against the artifact's schema before anything touches disk. */
export function writeArtifact(runDir: string, name: string, data: unknown): void {
  const parsed = schemaFor(name).parse(data);
  const file = path.join(runDir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
}
