#!/usr/bin/env -S npx tsx
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { bootstrap, exitCodeFor } from "./bootstrap";
import { type SecretName, ConfigError } from "./config";
import { executeAll, executeStage, STAGES } from "./commands";
import type { Stage } from "./commands/types";
import { createRunDir } from "./run-dir";

type Opts = { config?: string; feature?: string; runId?: string; force?: boolean; ticket?: string; ticketFile?: string; pr?: string; goal?: string; revise?: boolean };

function fail(e: unknown): void {
  const code = exitCodeFor(e);
  if (code === undefined) throw e;
  console.error((e as Error).message);
  process.exitCode = code;
}

async function runCommand(name: string, stages: Stage[], opts: Opts): Promise<void> {
  try {
    const needs = [...new Set(stages.flatMap((s) => s.needs))] as SecretName[];
    const b = bootstrap({ configPath: opts.config, needs }); // step 0: doctor
    if (!opts.feature) throw new ConfigError("--feature is required");
    if (!opts.runId) throw new ConfigError("--run-id is required");

    const creates = stages[0]!.createsRunDir;
    let runDir: string;
    if (creates) {
      runDir = createRunDir(b.config.runRoot, opts.feature, opts.runId, { force: !!opts.force });
    } else {
      runDir = path.join(b.config.runRoot, opts.feature, "runs", opts.runId);
      if (!existsSync(runDir)) throw new ConfigError(`${name}: run directory not found: ${runDir}`);
    }

    const { ticket, ticketFile, pr, goal, revise } = opts;
    const ctx = { config: b.config, runbook: b.runbook, runDir, env: b.env, force: !!opts.force, args: { ticket, ticketFile, pr, goal, revise } };
    process.exitCode = stages.length === 1 ? await executeStage(stages[0]!, ctx) : await executeAll(ctx);
  } catch (e) {
    fail(e);
  }
}

const program = new Command().name("qa").description("QA harness driven by a QA Runbook");

program
  .command("doctor")
  .description("validate config, secrets and the Runbook")
  .option("--config <path>", "path to qa-harness.config.json")
  .action((opts: Opts) => {
    try {
      const b = bootstrap({ configPath: opts.config, needs: [] });
      console.log(`ok (runbook: ${b.runbook.root}, ${b.runbook.modules.length} modules)`);
    } catch (e) {
      fail(e);
    }
  });

const withOpts = (c: Command) =>
  c
    .option("--config <path>", "path to qa-harness.config.json")
    .option("--feature <name>", "feature / ticket key")
    .option("--run-id <id>", "run id")
    .option("--force", "reuse an existing run directory");

const withInputs = (c: Command) =>
  c
    .option("--ticket <id>", "Linear issue id (needs LINEAR_API_KEY)")
    .option("--ticket-file <path>", "ticket text file (offline)")
    .option("--pr <url>", "GitHub pull request URL")
    .option("--goal <text>", "test goal text");

for (const stage of STAGES) {
  const cmd = withOpts(program.command(stage.name));
  (stage.name === "extract" ? withInputs(cmd) : stage.name === "design" ? cmd.option("--revise", "regenerate only the cases the review marked revise") : cmd).action((opts: Opts) => runCommand(stage.name, [stage], opts));
}
withInputs(withOpts(program.command("all").description("run every stage in order"))).action((opts: Opts) =>
  runCommand("all", STAGES, opts),
);

program.parseAsync(process.argv);
