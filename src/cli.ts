#!/usr/bin/env -S npx tsx
import { Command } from "commander";

const program = new Command().name("qa").description("QA harness driven by a QA Runbook");

for (const name of ["doctor", "extract", "design", "review", "run", "report", "all"]) {
  program.command(name).action(() => {
    console.error(`${name} not implemented`);
    process.exitCode = 1;
  });
}

program.parseAsync(process.argv);
