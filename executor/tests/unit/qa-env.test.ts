import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { qaEnvExamplePath, qaEnvPath } from "../../src/tools/qa-env";

it("keeps local QA configuration beside the packaged runtime", () => {
  const runtimeRoot = fileURLToPath(new URL("../../", import.meta.url));
  expect(qaEnvPath).toBe(path.resolve(runtimeRoot, "../qa-env/.env.local"));
  expect(qaEnvExamplePath).toBe(path.resolve(runtimeRoot, "../qa-env/.env.example"));
});

it("reads only the non-secret path variables, never the credentials beside them", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const { readQaPaths } = await import("../../src/tools/qa-env");
  const dir = await mkdtemp(path.join(os.tmpdir(), "qa-env-root-"));
  const file = path.join(dir, ".env.local");
  try {
    await writeFile(file, "E2B_API_KEY=e2b_secret_value\nQA_ROOT='/data/QA root'\nCLERK_SECRET_KEY=sk_test_abc\nPRODUCT_REPO=/src/hellyeah-v2\n");
    const paths = readQaPaths({}, file);
    expect(paths).toEqual({ QA_ROOT: path.resolve("/data/QA root"), source: file, PRODUCT_REPO: "/src/hellyeah-v2" });
    expect(JSON.stringify(paths)).not.toMatch(/e2b_secret|sk_test/);
    expect(readQaPaths({ QA_ROOT: "/env/root" }, file)).toMatchObject({ QA_ROOT: path.resolve("/env/root"), source: "environment" });
    expect(readQaPaths({}, path.join(dir, "missing"))).toEqual({ QA_ROOT: null, source: null });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("prints QA_ROOT through pnpm qa-env:root without any credential", async () => {
  const { spawnSync } = await import("node:child_process");
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/qa-env-root.ts", "--plain"], {
    cwd, encoding: "utf8", env: { ...process.env, QA_ROOT: "/tmp/qa-root-probe" },
  });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(path.resolve("/tmp/qa-root-probe"));
  const json = spawnSync(process.execPath, ["--import", "tsx", "scripts/qa-env-root.ts"], {
    cwd, encoding: "utf8", env: { ...process.env, QA_ROOT: "/tmp/qa-root-probe" },
  });
  expect(Object.keys(JSON.parse(json.stdout)).sort()).toEqual(expect.arrayContaining(["QA_ROOT", "source"]));
  expect(json.stdout).not.toMatch(/E2B_API_KEY|e2b_|sk_(?:test|live)/);
});
