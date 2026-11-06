import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { ExitCode } from "./exit-codes";

export class ConfigError extends Error {
  readonly exitCode = ExitCode.CONFIG;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type SecretName = "OPENAI_API_KEY" | "E2B_API_KEY" | "LINEAR_API_KEY";

const schema = z
  .object({
    runbook: z.object({ path: z.string().min(1) }).strict(),
    runRoot: z.string().min(1),
    executor: z.object({ root: z.string().min(1) }).strict(),
    llm: z
      .object({
        model: z.string().min(1),
        baseUrl: z.string().url().default("https://api.openai.com/v1"),
        maxRetries: z.number().int().min(0).default(2),
      })
      .strict(),
    design: z.object({ maxCases: z.number().int().positive().default(12) }).strict().default({ maxCases: 12 }),
    run: z
      .object({
        caseTimeoutMs: z.number().int().positive().default(300000),
        totalTimeoutMs: z.number().int().positive().default(3600000),
      })
      .strict()
      .default({ caseTimeoutMs: 300000, totalTimeoutMs: 3600000 }),
  })
  .strict();

export type Config = z.infer<typeof schema> & { configDir: string };

const SECRETISH = /KEY|SECRET|TOKEN|PASSWORD/i;

export function loadConfig(opts: { configPath?: string; cwd: string; env: NodeJS.ProcessEnv }): Config {
  const file = path.resolve(
    opts.configPath ?? opts.env.QA_HARNESS_CONFIG ?? path.join(opts.cwd, "qa-harness.config.json"),
  );
  if (!existsSync(file)) throw new ConfigError(`config file not found: ${file}`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`config file is not valid JSON: ${file} (${(e as Error).message})`);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => {
      const where = i.path.join(".") || "(root)";
      const unknownKeys = i.code === "unrecognized_keys" ? i.keys : [];
      const secretNote = unknownKeys.some((k) => SECRETISH.test(k))
        ? " — secrets belong in the environment or .env.local, not in the config file"
        : "";
      return `${where}: ${i.message}${unknownKeys.length ? ` [${unknownKeys.join(", ")}]` : ""}${secretNote}`;
    });
    throw new ConfigError(`invalid config ${file}: ${problems.join("; ")}`);
  }

  const dir = path.dirname(file);
  const c = parsed.data;
  return {
    ...c,
    configDir: dir,
    runbook: { path: path.resolve(dir, c.runbook.path) },
    runRoot: path.resolve(dir, c.runRoot),
    executor: { root: path.resolve(dir, c.executor.root) },
  };
}

/**
 * Real environment wins, then <configDir>/.env.local, then <configDir>/qa-env/.env.local (the file the
 * executor reads, so one file serves both). Does not mutate process.env.
 */
export function loadEnvFile(config: Config, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const read = (file: string) => (existsSync(file) ? dotenv.parse(readFileSync(file)) : {});
  return {
    ...read(path.join(config.configDir, "qa-env", ".env.local")),
    ...read(path.join(config.configDir, ".env.local")),
    ...env,
  };
}

export function requireSecrets(needs: SecretName[], env: NodeJS.ProcessEnv): void {
  const missing = needs.filter((k) => !env[k]);
  if (missing.length) throw new ConfigError(`missing required secret(s): ${missing.join(", ")}`);
}
