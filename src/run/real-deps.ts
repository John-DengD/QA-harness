import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Env } from "../contracts/env";
import { ExternalError } from "../errors";
import { makeRedactor } from "../redact";
import type { ExecLike } from "../sources/types";
import type { ScriptValidator } from "./generate";
import type { PlaywrightRunner, RunRegistry, SandboxDriver } from "./types";

const SECRETISH = /KEY|SECRET|TOKEN|PASSWORD/i;
const secretsOf = (env: NodeJS.ProcessEnv) => Object.entries(env).filter(([k, v]) => SECRETISH.test(k) && v).map(([, v]) => v!);
const withQaRoot = (env: NodeJS.ProcessEnv, qaRoot: string): NodeJS.ProcessEnv => ({ ...env, QA_ROOT: qaRoot });
const originOf = (u: string): string | undefined => {
  try {
    return new URL(u).origin;
  } catch {
    return undefined;
  }
};
const ident = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "x").slice(0, 120) || "x";

function lastJson(stdout: string): any {
  const lines = stdout.trim().split("\n").reverse();
  for (const l of lines) {
    try {
      return JSON.parse(l);
    } catch {
      /* keep looking */
    }
  }
  throw new Error(`no JSON object in command output: ${stdout.slice(0, 200)}`);
}

function failure(what: string, r: { code: number; stdout: string; stderr: string }, env: NodeJS.ProcessEnv): Error {
  const clean = makeRedactor(secretsOf(env));
  return new Error(`${what} failed (exit ${r.code}): ${clean((r.stderr || r.stdout).trim()).slice(0, 800)}`);
}

export function makeSandboxDriver(opts: { executorRoot: string; qaRoot: string; env: NodeJS.ProcessEnv; exec: ExecLike }): SandboxDriver {
  const run = async (what: string, args: string[], origin?: string) => {
    const base = withQaRoot(opts.env, opts.qaRoot);
    // The executor only drives origins it is told about; the harness resolved this one itself (spec §13).
    const allowed = origin ? originOf(origin) : undefined;
    const env = allowed ? { ...base, QA_ALLOWED_ORIGINS: allowed } : base;
    const r = await opts.exec("pnpm", ["exec", "tsx", "scripts/qa-sandbox.ts", ...args], { cwd: opts.executorRoot, env });
    if (r.code !== 0) throw failure(`sandbox ${what}`, r, opts.env);
    return lastJson(r.stdout);
  };
  return {
    async create({ url }) {
      const j = await run("create", ["create", "--url", url], url);
      if (typeof j.sandboxId !== "string") throw new Error("sandbox create returned no sandboxId");
      return { sandboxId: j.sandboxId };
    },
    async startRecording(id, caseDir) {
      await run("record-start", ["record-start", "--sandbox-id", id, "--case-dir", caseDir]);
    },
    async stopRecording(id, caseDir) {
      const j = await run("record-stop", ["record-stop", "--sandbox-id", id, "--case-dir", caseDir]);
      return { videoPath: String(j.video), bytes: Number(j.bytes) };
    },
    async snapshot(id, origin) {
      const j = await run("snapshot", ["snapshot", "--sandbox-id", id, "--origin", origin], origin);
      return `URL: ${j.url}\nTitle: ${j.title}\n\n${j.snapshot}`;
    },
    async kill(id) {
      await run("kill", ["kill", "--sandbox-id", id]);
    },
  };
}

/** Gives a directory of generated specs what it needs to run against the executor without touching the executor repo. */
export function ensureGeneratedHarness(dir: string, executorRoot: string): void {
  mkdirSync(dir, { recursive: true });
  const link = path.join(dir, "node_modules");
  if (!existsSync(link)) symlinkSync(path.join(executorRoot, "node_modules"), link, "dir");
  const write = (name: string, text: string) => {
    const f = path.join(dir, name);
    if (!existsSync(f)) writeFileSync(f, text);
  };
  // ESM like the executor, whatever package the run directory happens to sit in.
  write("package.json", JSON.stringify({ type: "module" }));
  write("fixtures.ts", `export { test, expect } from ${JSON.stringify(path.join(executorRoot, "src", "fixtures"))};\n`);
  write(
    "playwright.config.ts",
    `import base from ${JSON.stringify(path.join(executorRoot, "playwright.config"))};\nexport default { ...base, testDir: "." };\n`,
  );
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true, types: ["node"] }, include: ["*.ts"] }, null, 2),
  );
}

const outsideExecutor = (spec: string, executorRoot: string) => path.isAbsolute(spec) && !path.resolve(spec).startsWith(path.resolve(executorRoot) + path.sep);

export function makePlaywrightRunner(opts: { executorRoot: string; qaRoot: string; env: NodeJS.ProcessEnv; exec: ExecLike }): PlaywrightRunner {
  return {
    async run({ sandboxId, specPath, grep, outputDir, timeoutMs }) {
      const args = ["exec", "tsx", "scripts/run-e2b-playwright.ts", sandboxId];
      if (outsideExecutor(specPath, opts.executorRoot)) {
        const dir = path.dirname(specPath);
        ensureGeneratedHarness(dir, opts.executorRoot);
        args.push("--config", path.join(dir, "playwright.config.ts"));
      }
      args.push(specPath);
      if (grep) args.push("--grep", grep);
      args.push("--reporter=json");
      mkdirSync(outputDir, { recursive: true });
      const reportPath = path.join(outputDir, "report.json");
      const r = await opts.exec("pnpm", args, {
        cwd: opts.executorRoot,
        timeoutMs,
        env: { ...withQaRoot(opts.env, opts.qaRoot), E2E_TEST_OUTPUT_DIR: outputDir, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
      });
      let reportJson: unknown | null = null;
      try {
        reportJson = JSON.parse(readFileSync(reportPath, "utf8"));
      } catch {
        reportJson = null;
      }
      return { exitCode: r.code, stdout: r.stdout, stderr: r.stderr, reportJson, timedOut: !!r.timedOut };
    },
  };
}

export function makeRegistry(opts: { executorRoot: string; qaRoot: string; env: NodeJS.ProcessEnv; exec: ExecLike }): RunRegistry {
  const env = withQaRoot(opts.env, opts.qaRoot);
  return {
    async register({ runId, feature, env: runEnv, taskModelRef }: { runDir: string; runId: string; feature: string; env: Env; taskModelRef: string }) {
      const f = ident(feature);
      const id = ident(runId);
      const runRoot = `${f}/runs/${id}`;
      // A re-run of the same run id reuses its registration (the executor creates it only once).
      const existing = await opts.exec("pnpm", ["exec", "tsx", "scripts/loop-state.ts", "inspect", "--qa-root", opts.qaRoot, "--run-id", id], { cwd: opts.executorRoot, env });
      if (existing.code === 0) {
        try {
          if (lastJson(existing.stdout).runRoot === runRoot) return;
        } catch {
          /* fall through to init */
        }
      }
      const r = await opts.exec(
        "pnpm",
        [
          "exec", "tsx", "scripts/loop-state.ts", "init",
          "--qa-root", opts.qaRoot, "--run-id", id, "--run-root", runRoot,
          "--journey-key", f, "--mode", "regression", "--feature", f,
          "--environment", ident(runEnv.kind), "--role", "qa", "--org-alias", "default",
          "--sha", ident(runEnv.headSha ?? "none"), "--executor-id", "qa-harness",
          "--task-model", `${runRoot}/${taskModelRef}`,
        ],
        { cwd: opts.executorRoot, env },
      );
      if (r.code !== 0) throw new ExternalError(failure("run registration", r, opts.env).message);
    },
  };
}

export function makeScriptValidator(opts: { executorRoot: string; qaRoot: string; env: NodeJS.ProcessEnv; exec: ExecLike }): ScriptValidator {
  const env = withQaRoot(opts.env, opts.qaRoot);
  return async (specPath) => {
    const dir = path.dirname(specPath);
    ensureGeneratedHarness(dir, opts.executorRoot);
    // One tsconfig per spec: a broken sibling spec must not fail this one.
    const tsconfig = path.join(dir, `${path.basename(specPath).replace(/\.spec\.ts$/, "").replace(/\.ts$/, "")}.tsconfig.json`);
    writeFileSync(
      tsconfig,
      JSON.stringify({ extends: "./tsconfig.json", include: [], files: [path.basename(specPath), "fixtures.ts"] }, null, 2),
    );
    const bin = (name: string) => path.join(opts.executorRoot, "node_modules", ".bin", name);
    const tsc = await opts.exec(bin("tsc"), ["-p", tsconfig, "--noEmit"], { cwd: dir, env });
    if (tsc.code !== 0) return { ok: false, output: (tsc.stdout + tsc.stderr).trim() };
    const list = await opts.exec(bin("playwright"), ["test", "--list", "--config", path.join(dir, "playwright.config.ts"), specPath], { cwd: dir, env });
    if (list.code !== 0) return { ok: false, output: (list.stdout + list.stderr).trim() };
    return { ok: true, output: "" };
  };
}
