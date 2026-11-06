import type { Config, SecretName } from "../config";
import type { Runbook } from "../runbook";

export type CommandContext = {
  config: Config;
  runbook: Runbook;
  runDir: string;
  env: NodeJS.ProcessEnv;
  force: boolean;
  /** Stage-specific command-line options (e.g. --ticket-file). */
  args: Record<string, string | boolean | undefined>;
};

export type Stage = {
  name: "extract" | "design" | "review" | "run" | "report";
  /** Secrets this stage needs; checked by doctor at step 0. */
  needs: SecretName[];
  /** Artifacts (relative to the run dir) that must exist before the stage body runs. */
  requires: string[];
  /** True for the stage that creates the run directory. */
  createsRunDir: boolean;
  run(ctx: CommandContext): Promise<number>;
};

export const notImplemented = (name: string) => async (): Promise<number> => {
  console.error(`${name} not implemented`);
  return 1;
};
