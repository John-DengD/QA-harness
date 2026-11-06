import path from "node:path";

import { resolveInstallMode } from "../src/tools/install-mode";

const result = resolveInstallMode({
  skillDir: path.resolve(import.meta.dirname, "../.."),
  sourceDirEnv: process.env.SKILL_SOURCE_DIR,
});
console.log(JSON.stringify(result));
