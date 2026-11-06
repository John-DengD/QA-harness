import path from "node:path";

/**
 * QA_ROOT for a CLI call: the explicit --qa-root, else QA_ROOT from the
 * environment (usually loaded from qa-env/.env.local by loadQaEnv()).
 * Existence is validated by the caller.
 */
export function resolveQaRootOption(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (explicit) return path.resolve(explicit);
  const fromEnv = env.QA_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  throw new Error(
    "QA_ROOT is not configured: pass --qa-root <path>, or run `pnpm qa:init -- --qa-root <path> --save` " +
    "once (saves QA_ROOT to qa-env/.env.local)."
  );
}
