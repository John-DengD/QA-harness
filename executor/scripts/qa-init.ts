import { parseArgs } from "node:util";
import { initQaRoot, skillDir } from "../src/tools/qa-init";
import { qaEnvPath } from "../src/tools/qa-env";

const usage = `Usage: pnpm qa:init -- --qa-root <absolute path> [--save]
  Creates QA_ROOT, QA_ROOT/.qa-loop and (only when absent) qa-workbench.md / qa-workbench-archive.md.
  --save  write QA_ROOT=<path> to qa-env/.env.local so other commands no longer need --qa-root`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"), allowPositionals: true,
    options: { "qa-root": { type: "string" }, save: { type: "boolean" } },
  });
  if (!values["qa-root"] || positionals.length) throw new Error(usage);
  const result = await initQaRoot({ qaRoot: values["qa-root"], skillDir, envFile: qaEnvPath, save: values.save });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
