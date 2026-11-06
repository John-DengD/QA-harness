import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { concludeDriftVerify, listDrift } from "../src/tools/action-drift";
import { actionCodeHashes, readActionHealth, resolveQaRoot } from "../src/tools/action-health";
import { actionIndex } from "../src/tools/action-index";
import { resolveInstallMode } from "../src/tools/install-mode";
import { loadQaEnv } from "../src/tools/qa-env";

const USAGE = `Usage: action:drift <list|verify> ...
  list   [--run-root RUN_ROOT] [--qa-root QA_ROOT] [--product-repo DIR] [--product-ref origin/staging|<sha>]
         This run's drift-suspected invocations plus every Action whose health is suspected_drift,
         with source location, failure evidence and a product source search to start from.
  verify <Action> --sandbox-id ID --case-dir RUN_ROOT/evidence/<case> --origin URL
         --reuse-log RUN_ROOT/run-state/action-reuse.jsonl --run-id ID
         [--args-json '[...]'] [--qa-root QA_ROOT] [--product-sha SHA] [--skip-checks]
         After repairing the Action: typecheck + its unit tests, rerun it on E2B (no reuse hit is
         logged), then conclude: repaired (health back to healthy) or a script_drift gap in loop:state.
  QA_ROOT defaults to the run's QA_ROOT, then QA_ROOT from env or qa-env/.env.local (see pnpm qa:init).`;

const root = path.resolve(import.meta.dirname, "..");

function fail(message: string): never {
  throw new Error(`${message}\n${USAGE}`);
}

function run(command: string, args: string[]): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n") };
}

async function unitTestsFor(action: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const directory = path.join(root, "tests", "unit");
  const files: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith(".test.ts")) continue;
    if ((await readFile(path.join(directory, name), "utf8")).includes(action)) files.push(`tests/unit/${name}`);
  }
  return files;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"), allowPositionals: true,
    options: {
      "qa-root": { type: "string" }, "run-root": { type: "string" },
      "product-repo": { type: "string" }, "product-ref": { type: "string" }, "product-sha": { type: "string" },
      "sandbox-id": { type: "string" }, "case-dir": { type: "string" }, origin: { type: "string" },
      "reuse-log": { type: "string" }, "run-id": { type: "string" }, "args-json": { type: "string" },
      "skip-checks": { type: "boolean" },
    },
  });
  loadQaEnv();
  const command = positionals[0];
  const hotlist = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
  const entries = await actionIndex(root, hotlist.actions);

  if (command === "list") {
    if (positionals.length !== 1) fail("list takes no positional arguments");
    const runRoot = values["run-root"] ? path.resolve(values["run-root"]) : undefined;
    const qaRoot = values["qa-root"] ? path.resolve(values["qa-root"])
      : runRoot ? resolveQaRoot(runRoot) : process.env.QA_ROOT ? path.resolve(process.env.QA_ROOT) : null;
    const productRepo = values["product-repo"] ?? process.env.PRODUCT_REPO ?? path.join(os.homedir(), "git-projects", "hellyeah-v2");
    const actions = await listDrift({
      qaRoot, runRoot, entries, codeHashes: actionCodeHashes(root, entries.map((entry) => entry.file)),
      productRepo, productRef: values["product-ref"],
    });
    console.log(JSON.stringify({
      qaRoot, runRoot: runRoot ?? null, productRepo, productRef: values["product-ref"] ?? "origin/staging",
      actions,
      nextSteps: actions.length ? [
        "Compare each locator with the target product source (deployment SHA, or origin/staging for staging) using productSearch; read the failure snapshot for the current roles and names.",
        "Repair the smallest layer (locator in the page/action, interaction contract in the action); never change a business Expected from product source.",
        "pnpm action:drift verify <Action> --sandbox-id ... --case-dir RUN_ROOT/evidence/<drift case> --origin ... --reuse-log ... --run-id ...",
      ] : [],
    }, null, 2));
    return;
  }

  if (command === "verify") {
    const action = positionals[1];
    if (positionals.length !== 2 || !action) fail("verify needs exactly one Action name");
    const entry = entries.find((item) => item.name === action);
    if (!entry) fail(`${action} is not an exported library Action`);
    const required = ["sandbox-id", "case-dir", "origin", "reuse-log", "run-id"] as const;
    for (const name of required) if (!values[name]) fail(`verify needs --${name}`);
    const runRoot = path.dirname(path.dirname(path.resolve(values["reuse-log"]!)));
    const qaRoot = resolveQaRoot(runRoot, values["qa-root"])
      ?? (process.env.QA_ROOT?.trim() ? path.resolve(process.env.QA_ROOT.trim()) : null);
    if (!qaRoot) fail("Cannot find QA_ROOT for this run; pass --qa-root or run `pnpm qa:init -- --qa-root <path> --save`");

    const checks: Array<{ step: string; ok: boolean; output: string }> = [];
    if (!values["skip-checks"]) {
      checks.push({ step: "pnpm typecheck", ...run("pnpm", ["typecheck"]) });
      const tests = await unitTestsFor(action);
      if (tests.length) checks.push({ step: `vitest run ${tests.join(" ")}`, ...run("pnpm", ["exec", "vitest", "run", ...tests]) });
      const failed = checks.find((check) => !check.ok);
      if (failed) {
        console.log(JSON.stringify({ action, checks, rerun: null, conclusion: null,
          nextStep: `${failed.step} failed: fix it before rerunning on E2B` }, null, 2));
        process.exitCode = 1;
        return;
      }
    }

    const caseDir = path.resolve(values["case-dir"]!);
    const intentId = `drift-verify-${action}`.slice(0, 160);
    const rerunArgs = ["--import", "tsx", "scripts/e2b-action.ts",
      "--sandbox-id", values["sandbox-id"]!, "--case-dir", caseDir, "--origin", values.origin!,
      "--action", action, "--reuse-log", values["reuse-log"]!, "--run-id", values["run-id"]!,
      "--intent-id", intentId, "--verify-only", "--qa-root", qaRoot,
      ...(values["args-json"] ? ["--args-json", values["args-json"]] : []),
      ...(values["product-sha"] ? ["--product-sha", values["product-sha"]] : [])];
    const rerun = spawnSync(process.execPath, rerunArgs, { cwd: root, encoding: "utf8", env: process.env, timeout: 10 * 60_000 });
    const lastLine = (rerun.stdout ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "";
    let rerunResult: Record<string, unknown> | null = null;
    try { rerunResult = JSON.parse(lastLine) as Record<string, unknown>; } catch { rerunResult = null; }
    if (!rerunResult) {
      // e2b:action refused before running (usage, recording, preflight): nothing was verified.
      console.log(JSON.stringify({ action, checks, rerun: null, conclusion: null,
        error: (rerun.stderr ?? "").trim().split("\n").slice(-5).join("\n") }, null, 2));
      process.exitCode = 1;
      return;
    }
    const conclusion = await concludeDriftVerify({
      qaRoot, runRoot, action, caseId: path.basename(caseDir),
      rerun: {
        status: String(rerunResult.status),
        invocationId: typeof rerunResult.invocationId === "string" ? rerunResult.invocationId : null,
        factPath: typeof rerunResult.factPath === "string" ? rerunResult.factPath : null,
        failureSnapshot: typeof rerunResult.failureSnapshot === "string" ? rerunResult.failureSnapshot : null,
      },
    });
    const health = (await readActionHealth(qaRoot)).actions[action] ?? null;
    const mode = resolveInstallMode({ skillDir: path.resolve(root, ".."), sourceDirEnv: process.env.SKILL_SOURCE_DIR });
    console.log(JSON.stringify({
      action, checks, rerun: rerunResult, conclusion, health,
      sedimentation: conclusion.outcome === "repaired"
        ? { mode, nextStep: mode.mode === "local"
            ? `Verified on a real page: commit the repair in ${mode.sourceDir} (hy_ui_autotest page/action + unit test) per sedimentation-modes.md local rule, then sync the installed copy. git push stays manual.`
            : "remote install: keep the repaired code and this result under QA_ROOT/<feature>/ as a candidate; do not edit the install snapshot." }
        : null,
    }, null, 2));
    process.exitCode = conclusion.outcome === "repaired" ? 0 : 1;
    return;
  }
  fail(`Unknown command ${command ?? "(none)"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
