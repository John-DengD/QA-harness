#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { bootstrap, exitCodeFor } from "./bootstrap";

const program = new Command().name("qa").description("QA harness driven by a QA Runbook");

program
  .command("doctor")
  .description("validate config, secrets and the Runbook")
  .option("--config <path>", "path to qa-harness.config.json")
  .action((opts: { config?: string }) => {
    try {
      const b = bootstrap({ configPath: opts.config, needs: [] });
      console.log(`ok (runbook: ${b.runbook.root}, ${b.runbook.modules.length} modules)`);
    } catch (e) {
      const code = exitCodeFor(e);
      if (code === undefined) throw e;
      console.error((e as Error).message);
      process.exitCode = code;
    }
  });

for (const name of ["extract", "design", "review", "run", "report", "all"]) {
  program.command(name).action(() => {
    console.error(`${name} not implemented`);
    process.exitCode = 1;
  });
}

program.parseAsync(process.argv);
