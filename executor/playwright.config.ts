import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

import { buildClerkHostResolverArgs } from "./src/tools/clerk-host-resolver";
import { buildReportMetadata } from "./src/report/runtime-metadata";
import { loadQaEnv } from "./src/tools/qa-env";

loadQaEnv();
process.env.MIDSCENE_RUN_DIR ??= path.resolve(process.env.E2E_RUN_OUTPUT_DIR ?? "midscene_run");
process.env.MIDSCENE_PREFERRED_LANGUAGE ??= "English";

const clerkHostResolverArgs = buildClerkHostResolverArgs(
  process.env.CLERK_PUBLISHABLE_KEY,
  process.env.E2E_CLERK_FAPI_IP
);
const agentQaMode = process.env.E2E_AGENT_QA === "true";

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: false,
  metadata: buildReportMetadata(process.env),
  outputDir: process.env.E2E_TEST_OUTPUT_DIR ?? "test-results",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions:
          clerkHostResolverArgs.length > 0
            ? { args: clerkHostResolverArgs }
            : undefined,
        viewport: { height: 900, width: 1440 },
      },
    },
  ],
  reporter: agentQaMode ? [["list"]] : [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: process.env.E2E_REPORT_OUTPUT_DIR ?? "playwright-report",
      },
    ],
    [
      "@midscene/web/playwright-reporter",
      { outputFormat: "html-and-external-assets", type: "merged" },
    ],
  ],
  retries: 0,
  testDir: "tests/release",
  timeout: 20 * 60_000,
  use: {
    actionTimeout: 20_000,
    baseURL:
      process.env.E2E_BASE_URL ?? "https://app-staging.hellyeahai.com",
    navigationTimeout: 45_000,
    screenshot: "only-on-failure",
    trace: agentQaMode ? "off" : "on",
    video: "on",
  },
  workers: 1,
});
