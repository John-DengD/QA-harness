import path from "node:path";
import { Sandbox } from "@e2b/desktop";
import { spawn } from "node:child_process";

import { assertRegisteredRun } from "../src/loop/run-gate";
import { loadQaEnv } from "../src/tools/qa-env";
import { discoverPrivateCdp } from "../src/tools/e2b-shared-browser";

async function main(): Promise<void> {
  const [sandboxId, ...caseArgs] = process.argv.slice(2);
  if (!sandboxId || !/^[a-z0-9]+$/.test(sandboxId) || caseArgs.length === 0) {
    throw new Error("Usage: run-e2b-playwright <sandbox-id> <Playwright test arguments>");
  }
  loadQaEnv(true);
  const outputDir = process.env.E2E_TEST_OUTPUT_DIR;
  if (!outputDir) throw new Error("Set E2E_TEST_OUTPUT_DIR to <RUN_ROOT>/evidence/... before running Playwright Cases");
  await assertRegisteredRun(outputDir);
  const sandbox = await Sandbox.connect(sandboxId);
  const { endpoint, accessToken } = await discoverPrivateCdp(sandbox);
  const child = spawn("pnpm", ["exec", "playwright", "test", ...caseArgs], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      E2E_CDP_ACCESS_TOKEN: accessToken,
      E2E_CDP_URL: endpoint,
    },
    stdio: "inherit",
  });
  const result = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Playwright stopped by ${signal}`));
      else resolve(code ?? 1);
    });
  });
  process.exitCode = result;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
