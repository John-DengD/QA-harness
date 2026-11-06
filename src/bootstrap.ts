import { type Config, ConfigError, loadConfig, loadEnvFile, type SecretName } from "./config";
import { runDoctor } from "./doctor";
import { loadRunbook, type Runbook } from "./runbook";

export type Bootstrapped = { config: Config; env: NodeJS.ProcessEnv; runbook: Runbook };

/** Step 0 of every command: config, secrets and Runbook must be valid before anything else runs. */
export function bootstrap(opts: { configPath?: string; needs: SecretName[] }): Bootstrapped {
  const config = loadConfig({ configPath: opts.configPath, cwd: process.cwd(), env: process.env });
  const env = loadEnvFile(config, process.env);
  const report = runDoctor(config, opts.needs, env);
  if (!report.ok) throw new ConfigError(report.problems.join("\n"));
  return { config, env, runbook: loadRunbook(config.runbook.path) };
}

export function exitCodeFor(e: unknown): number | undefined {
  const code = (e as { exitCode?: unknown } | null)?.exitCode;
  return typeof code === "number" ? code : undefined;
}
