import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The one path rule every loop tool shares (checker, omission, human review,
 * loop state, Action health, action:drift).
 *
 * QA_ROOT is the single top directory that holds `.qa-loop/` and
 * `qa-workbench.md`. A run lives at
 *
 *   RUN_ROOT = [<surface>/...]<feature>/runs/<runId>      (QA_ROOT-relative)
 *
 * The surface prefix is optional (zero or more safe segments, e.g.
 * `User-Dashboard-test`), so both `PR-1217/runs/r-1` (older layout) and
 * `User-Dashboard-test/PR-1327/runs/r-1` are valid. `scope.feature` is the last
 * segment before `runs` (`PR-1327`), never the prefixed path. The feature root
 * (where `result/` reports live) is `[<surface>/...]<feature>`.
 */
export const RUN_ROOT_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
const MAX_SURFACE_SEGMENTS = 4;

export type RunRootParts = {
  /** QA_ROOT-relative run root, unchanged. */
  runRoot: string;
  /** Surface prefix without trailing slash; "" when the feature sits directly under QA_ROOT. */
  surface: string;
  feature: string;
  runId: string;
  /** `[<surface>/]<feature>`: reports live under `<featureRoot>/result/`. */
  featureRoot: string;
};

export const RUN_ROOT_RULE = "runRoot must be [<surface>/]<feature>/runs/<runId> relative to QA_ROOT " +
  "(QA_ROOT is the directory holding .qa-loop; scope.feature is the segment before runs/)";

/** Splits a QA_ROOT-relative run root; throws when it does not follow the rule or names another feature/run. */
export function parseRunRoot(runRoot: string, expected: { feature?: string; runId?: string } = {}): RunRootParts {
  if (typeof runRoot !== "string" || !runRoot || runRoot.includes("\\") || path.posix.isAbsolute(runRoot)) {
    throw new Error(RUN_ROOT_RULE);
  }
  const segments = runRoot.split("/");
  if (segments.length < 3 || segments.length > 3 + MAX_SURFACE_SEGMENTS ||
      segments.some((segment) => !RUN_ROOT_SEGMENT.test(segment) || segment === "." || segment === "..")) {
    throw new Error(RUN_ROOT_RULE);
  }
  const runId = segments.at(-1)!;
  const feature = segments.at(-3)!;
  if (segments.at(-2) !== "runs") throw new Error(RUN_ROOT_RULE);
  if (expected.runId !== undefined && expected.runId !== runId) {
    throw new Error(`runRoot must identify this feature and runId: runId is "${expected.runId}" but runRoot ends with "${runId}"; ${RUN_ROOT_RULE}`);
  }
  if (expected.feature !== undefined && expected.feature !== feature) {
    throw new Error(`runRoot must identify this feature and runId: scope.feature is "${expected.feature}" ` +
      `but runRoot names "${feature}"; ${RUN_ROOT_RULE}`);
  }
  const surface = segments.slice(0, -3).join("/");
  return { runRoot, surface, feature, runId, featureRoot: surface ? `${surface}/${feature}` : feature };
}

/** True when `ref` is a strict descendant of the run root. */
export function isRunChild(ref: string, runRoot: string): boolean {
  return typeof ref === "string" && ref.startsWith(`${runRoot}/`);
}

/**
 * The run root a QA_ROOT-relative run file belongs to, e.g. the ledger
 * `<runRoot>/run-state/human-review.jsonl`. Null when `ref` is not
 * `<runRoot>/<suffix>`.
 */
export function runRootOfRef(ref: string, suffix: string): RunRootParts | null {
  if (typeof ref !== "string" || !ref.endsWith(`/${suffix}`)) return null;
  try {
    return parseRunRoot(ref.slice(0, -(suffix.length + 1)));
  } catch {
    return null;
  }
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function hasLoopDir(directory: string): boolean {
  const candidate = path.join(directory, ".qa-loop");
  return existsSync(candidate) && statSync(candidate).isDirectory();
}

/**
 * QA_ROOT for an absolute run root (or any path inside a run):
 *   1. the explicit --qa-root;
 *   2. QA_ROOT from the environment (qa-env/.env.local) when the run is inside it;
 *   3. the nearest ancestor that already has `.qa-loop/`;
 *   4. the directory above `[<surface>/]<feature>/runs/<runId>` — only
 *      unambiguous without a surface, so it is the old three-levels-up rule.
 * Null when none applies.
 */
export function resolveQaRootForRun(
  runRootPath: string, explicit?: string, env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (explicit) return path.resolve(explicit);
  const resolved = path.resolve(runRootPath);
  const fromEnv = env.QA_ROOT?.trim();
  if (fromEnv && within(path.resolve(fromEnv), resolved)) return path.resolve(fromEnv);
  let current = resolved;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    if (hasLoopDir(current)) return current;
  }
  return path.basename(path.dirname(resolved)) === "runs" ? path.resolve(resolved, "../../..") : null;
}

/** QA_ROOT-relative POSIX run root for an absolute run path under QA_ROOT. */
export function qaRelativeRunRoot(qaRoot: string, runRootPath: string): string {
  const relative = path.relative(path.resolve(qaRoot), path.resolve(runRootPath)).split(path.sep).join("/");
  return parseRunRoot(relative).runRoot;
}
