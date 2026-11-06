import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

import { parseRuntimeConfig } from "../src/config";
import { loadQaEnv, qaEnvExamplePath, qaEnvPath } from "../src/tools/qa-env";

const needsPlaywright = process.argv.includes("--playwright");
const needsAdmin = process.argv.includes("--admin");
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const required = ["E2B_API_KEY"];
if (needsAdmin) required.push("E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD");
if (needsPlaywright) {
  required.push(
    "E2E_ACCOUNT_EMAIL",
    "E2E_BASE_URL",
    "E2E_EMAIL_BASE",
    "E2E_TEST_PASSWORD",
    "CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "STAGING_E2E_ADMIN_TOKEN",
    "MIDSCENE_MODEL_API_KEY",
    "MIDSCENE_MODEL_BASE_URL",
    "MIDSCENE_MODEL_NAME",
    "MIDSCENE_MODEL_FAMILY"
  );
}

if (!existsSync(qaEnvPath)) {
  fail(`QA setup required. Create ${qaEnvPath} from ${qaEnvExamplePath}.\nRequired for this mode: ${required.join(", ")}.`);
}
loadQaEnv();
const values = parse(readFileSync(qaEnvPath));

const missing = required.filter((name) => !values[name]?.trim());
if (missing.length > 0) {
  fail(`Missing in ${qaEnvPath}: ${missing.join(", ")}.\nSee ${qaEnvExamplePath}; do not commit real values.`);
}
if (!values.E2B_API_KEY?.startsWith("e2b_")) {
  fail(`E2B_API_KEY in ${qaEnvPath} must be an E2B API key.`);
}
if (needsPlaywright) {
  try {
    parseRuntimeConfig(values);
  } catch (error) {
    fail(`Check host Playwright variables in ${qaEnvPath} against ${qaEnvExamplePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(
  `QA environment ready: ${needsPlaywright ? "E2B and host Playwright" : "E2B"}${needsAdmin ? " and Admin" : ""}. Values were not printed.`
);
