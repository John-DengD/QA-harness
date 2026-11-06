import { type Config, ConfigError, requireSecrets, type SecretName } from "./config";
import { loadEnvironments } from "./environments";
import { loadRunbook, RunbookError } from "./runbook";

export type DoctorReport = { ok: boolean; problems: string[] };

/** Collects every config, Runbook and secret problem; never throws for those. */
export function runDoctor(config: Config, needs: SecretName[], env: NodeJS.ProcessEnv): DoctorReport {
  const problems: string[] = [];
  try {
    loadEnvironments(loadRunbook(config.runbook.path));
  } catch (e) {
    if (e instanceof RunbookError) problems.push(e.message);
    else throw e;
  }
  try {
    requireSecrets(needs, env);
  } catch (e) {
    if (e instanceof ConfigError) problems.push(e.message);
    else throw e;
  }
  return { ok: problems.length === 0, problems };
}
