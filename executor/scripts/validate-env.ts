import { parseRuntimeConfig } from "../src/config";
import { loadQaEnv } from "../src/tools/qa-env";

loadQaEnv();
parseRuntimeConfig(process.env);
console.log("E2E environment contract is valid.");
