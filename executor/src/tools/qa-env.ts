import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotEnv, parse as parseDotEnv } from "dotenv";

export const qaEnvPath = path.resolve(import.meta.dirname, "../../../qa-env/.env.local");
export const qaEnvExamplePath = path.resolve(
  import.meta.dirname,
  "../../../qa-env/.env.example"
);

export function loadQaEnv(required = false): void {
  if (!existsSync(qaEnvPath)) {
    if (required) {
      throw new Error(
        `Missing ${qaEnvPath}. Create it from ${qaEnvExamplePath} and set E2B_API_KEY before testing.`
      );
    }
    return;
  }

  const result = loadDotEnv({ path: qaEnvPath, quiet: true });
  if (result.error) {
    throw new Error(`Cannot read ${qaEnvPath}: ${result.error.message}`);
  }
}

/** Path variables that are safe to print; everything else in .env.local is treated as a credential. */
const PATH_VARIABLES = ["PRODUCT_REPO", "SKILL_SOURCE_DIR"] as const;

export type QaPaths = { QA_ROOT: string | null; source: string | null } & Partial<Record<(typeof PATH_VARIABLES)[number], string>>;

/**
 * QA_ROOT (and the other non-secret path variables) without loading or
 * printing anything else from qa-env/.env.local: the environment wins, then the
 * file. Agents use `pnpm qa-env:root` instead of reading .env.local.
 */
export function readQaPaths(env: NodeJS.ProcessEnv = process.env, file = qaEnvPath): QaPaths {
  let parsed: Record<string, string> = {};
  if (existsSync(file)) parsed = parseDotEnv(readFileSync(file));
  const fromEnv = env.QA_ROOT?.trim();
  const fromFile = parsed.QA_ROOT?.trim();
  const result: QaPaths = fromEnv ? { QA_ROOT: path.resolve(fromEnv), source: "environment" }
    : fromFile ? { QA_ROOT: path.resolve(fromFile), source: file } : { QA_ROOT: null, source: null };
  for (const name of PATH_VARIABLES) {
    const value = env[name]?.trim() || parsed[name]?.trim();
    if (value) result[name] = value;
  }
  return result;
}
