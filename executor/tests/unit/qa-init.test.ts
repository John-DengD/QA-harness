import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initQaRoot, upsertQaRootLine } from "../../src/tools/qa-init";
import { resolveQaRootOption } from "../../src/tools/qa-root";

const temporaryRoots: string[] = [];
const packageDir = path.resolve(import.meta.dirname, "../..");
const skillDir = path.resolve(packageDir, "..");

async function tempDir(prefix = "qa-init-") {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveQaRootOption", () => {
  it("prefers the explicit --qa-root over QA_ROOT", () => {
    expect(resolveQaRootOption("relative/x", { QA_ROOT: "/env/root" })).toBe(path.resolve("relative/x"));
  });

  it("falls back to QA_ROOT from the environment", () => {
    expect(resolveQaRootOption(undefined, { QA_ROOT: "/env/root" })).toBe(path.resolve("/env/root"));
    expect(resolveQaRootOption("", { QA_ROOT: "/env/root" })).toBe(path.resolve("/env/root"));
  });

  it("explains how to configure QA_ROOT when nothing is set", () => {
    expect(() => resolveQaRootOption(undefined, {})).toThrow(/--qa-root.*pnpm qa:init -- --qa-root <path>/s);
    expect(() => resolveQaRootOption(undefined, { QA_ROOT: "  " })).toThrow(/qa-env\/\.env\.local/);
  });
});

describe("initQaRoot", () => {
  it("creates QA_ROOT, .qa-loop and both workbench files", async () => {
    const base = await tempDir();
    const qaRoot = path.join(base, "nested", "qa");
    const result = await initQaRoot({ qaRoot, skillDir, envFile: path.join(base, ".env.local") });
    expect(result).toEqual({
      qaRoot, created: [".", ".qa-loop", "qa-workbench.md", "qa-workbench-archive.md"], kept: [], saved: false,
    });
    expect((await stat(path.join(qaRoot, ".qa-loop"))).isDirectory()).toBe(true);
    const workbench = await readFile(path.join(qaRoot, "qa-workbench.md"), "utf8");
    expect(workbench).toBe("# QA 工作台\n\n所有需要人处理的事都在这里。规范、类型与映射表见 skill 内 `QA-Knowledge/qa-workbench.md`。\n\n## 必须处理\n\n## 让系统变强\n\n## 可选\n");
    expect(await readFile(path.join(qaRoot, "qa-workbench-archive.md"), "utf8"))
      .toBe("# QA 工作台归档\n\n已处理并映射完成的条目，只保留处理轨迹，不作为测试依据。\n");
    expect(existsSync(path.join(base, ".env.local"))).toBe(false);
  });

  it("never overwrites existing files and reports them as kept", async () => {
    const qaRoot = await tempDir();
    await mkdir(path.join(qaRoot, ".qa-loop"));
    await writeFile(path.join(qaRoot, "qa-workbench.md"), "my notes\n");
    const result = await initQaRoot({ qaRoot, skillDir, envFile: path.join(qaRoot, "unused.env") });
    expect(result.created).toEqual(["qa-workbench-archive.md"]);
    expect(result.kept).toEqual([".", ".qa-loop", "qa-workbench.md"]);
    expect(await readFile(path.join(qaRoot, "qa-workbench.md"), "utf8")).toBe("my notes\n");
  });

  it("creates a 0600 env file containing only QA_ROOT when absent", async () => {
    const base = await tempDir();
    const qaRoot = path.join(base, "qa");
    const envFile = path.join(base, "env", ".env.local");
    await mkdir(path.dirname(envFile));
    const result = await initQaRoot({ qaRoot, skillDir, envFile, save: true });
    expect(result.saved).toBe(true);
    expect(await readFile(envFile, "utf8")).toBe(`QA_ROOT=${qaRoot}\n`);
    expect((await stat(envFile)).mode & 0o777).toBe(0o600);
  });

  it("appends QA_ROOT and preserves every other line byte-for-byte", async () => {
    const base = await tempDir();
    const qaRoot = path.join(base, "qa");
    const envFile = path.join(base, ".env.local");
    const original = "E2B_API_KEY=secret\r\n# comment\n\nOTHER='x y'";
    await writeFile(envFile, original, { mode: 0o640 });
    await initQaRoot({ qaRoot, skillDir, envFile, save: true });
    expect(await readFile(envFile, "utf8")).toBe(`${original}\nQA_ROOT=${qaRoot}\n`);
    expect((await stat(envFile)).mode & 0o777).toBe(0o640);
  });

  it("replaces an existing QA_ROOT line only", async () => {
    const base = await tempDir();
    const qaRoot = path.join(base, "qa");
    const envFile = path.join(base, ".env.local");
    await writeFile(envFile, "A=1\nQA_ROOT=/old/root\r\nB=2\n");
    await initQaRoot({ qaRoot, skillDir, envFile, save: true });
    expect(await readFile(envFile, "utf8")).toBe(`A=1\nQA_ROOT=${qaRoot}\r\nB=2\n`);
  });

  it("quotes paths that dotenv would otherwise misread", () => {
    expect(upsertQaRootLine("", "/a b/#c")).toBe("QA_ROOT='/a b/#c'\n");
  });

  it("rejects QA_ROOT inside the skill directory or /tmp", async () => {
    const envFile = path.join(await tempDir(), ".env.local");
    for (const qaRoot of [skillDir, path.join(skillDir, "runs"), "/tmp/qa-root", "/private/tmp/qa-root"]) {
      await expect(initQaRoot({ qaRoot, skillDir, envFile, save: true })).rejects.toThrow(/skill directory|\/tmp/);
    }
    expect(existsSync(envFile)).toBe(false);
    expect(existsSync("/tmp/qa-root")).toBe(false);
  });
});

describe("CLIs without --qa-root", () => {
  it("loop:state reads QA_ROOT from the environment", async () => {
    const root = await tempDir("qa-loop-env-");
    const prefix = "PR-1217/runs/env-run";
    await mkdir(path.join(root, prefix, "run-state"), { recursive: true });
    await writeFile(path.join(root, prefix, "run-state", "ticket-task-model.md"), "# env run\n");
    const invoke = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath,
      ["--import", "tsx", "scripts/loop-state.ts", ...args], { cwd: packageDir, encoding: "utf8", env });
    const env = { ...process.env, QA_ROOT: root };
    const init = invoke(env, "init", "--run-id", "env-run", "--run-root", prefix,
      "--journey-key", "google-tracking-launch", "--mode", "new", "--feature", "PR-1217",
      "--environment", "staging", "--role", "customer", "--org-alias", "qa-1", "--sha", "a868f1f",
      "--executor-id", "agent-1", "--task-model", `${prefix}/run-state/ticket-task-model.md`);
    expect(init.stderr).toBe("");
    expect(init.status).toBe(0);
    const inspect = invoke(env, "inspect", "--run-id", "env-run");
    expect(inspect.status).toBe(0);
    expect(JSON.parse(inspect.stdout)).toHaveProperty("runId", "env-run");
    // explicit --qa-root still wins over QA_ROOT
    const other = await tempDir("qa-loop-other-");
    const explicit = invoke(env, "inspect", "--qa-root", other, "--run-id", "env-run");
    expect(explicit.status).not.toBe(0);
  });

  it("qa:init CLI prints a JSON summary", async () => {
    const base = await tempDir();
    const qaRoot = path.join(base, "qa");
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/qa-init.ts", "--", "--qa-root", qaRoot],
      { cwd: packageDir, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ qaRoot, saved: false, kept: [] });
    const refused = spawnSync(process.execPath, ["--import", "tsx", "scripts/qa-init.ts", "--qa-root", skillDir],
      { cwd: packageDir, encoding: "utf8" });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/skill directory/);
  });
});
