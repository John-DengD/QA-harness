import { readQaPaths } from "../src/tools/qa-env";

/**
 * Prints QA_ROOT (and the non-secret path variables PRODUCT_REPO /
 * SKILL_SOURCE_DIR when set) without exposing anything else from
 * qa-env/.env.local. `--plain` prints only the QA_ROOT path.
 */
const paths = readQaPaths();
if (!paths.QA_ROOT) {
  console.error("QA_ROOT is not configured: run `pnpm qa:init -- --qa-root <path> --save` once, or pass --qa-root to each tool.");
  process.exitCode = 1;
} else if (process.argv.includes("--plain")) {
  console.log(paths.QA_ROOT);
} else {
  console.log(JSON.stringify(paths, null, 2));
}
