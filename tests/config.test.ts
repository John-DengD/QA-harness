import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigError, loadConfig, loadEnvFile, requireSecrets } from "../src/config";

function setup(extra: Record<string, unknown> = {}, envFile?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-cfg-"));
  const file = path.join(dir, "qa-harness.config.json");
  writeFileSync(
    file,
    JSON.stringify({
      runbook: { path: "runbook" },
      runRoot: "runs",
      executor: { root: "executor" },
      llm: { model: "gpt-test" },
      ...extra,
    }),
  );
  if (envFile !== undefined) writeFileSync(path.join(dir, ".env.local"), envFile);
  return { dir, file };
}

describe("loadConfig", () => {
  it("resolves relative paths against the config file directory and applies defaults", () => {
    const { dir, file } = setup();
    const cfg = loadConfig({ configPath: file, cwd: "/", env: {} });
    expect(cfg.runbook.path).toBe(path.join(dir, "runbook"));
    expect(cfg.runRoot).toBe(path.join(dir, "runs"));
    expect(cfg.executor.root).toBe(path.join(dir, "executor"));
    expect(cfg.llm).toEqual({ model: "gpt-test", baseUrl: "https://api.openai.com/v1", maxRetries: 2 });
    expect(cfg.design.maxCases).toBe(12);
    expect(cfg.run).toEqual({ caseTimeoutMs: 300000, totalTimeoutMs: 3600000 });
  });

  it("gives the same paths whatever the cwd is", () => {
    const { file } = setup();
    const a = loadConfig({ configPath: file, cwd: "/", env: {} });
    const b = loadConfig({ configPath: file, cwd: tmpdir(), env: {} });
    expect(a).toEqual(b);
  });

  it("names the looked-for path when the file is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-cfg-"));
    const missing = path.join(dir, "nope.json");
    expect(() => loadConfig({ configPath: missing, cwd: dir, env: {} })).toThrow(ConfigError);
    expect(() => loadConfig({ configPath: missing, cwd: dir, env: {} })).toThrow(missing);
  });

  it("finds qa-harness.config.json in cwd when no path is given", () => {
    const { dir } = setup();
    expect(loadConfig({ cwd: dir, env: {} }).runRoot).toBe(path.join(dir, "runs"));
  });

  it("reports unparsable JSON as ConfigError with the path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-cfg-"));
    const file = path.join(dir, "bad.json");
    writeFileSync(file, "{ not json");
    expect(() => loadConfig({ configPath: file, cwd: dir, env: {} })).toThrow(file);
  });

  it("rejects secrets placed in the config file", () => {
    const { file } = setup({ OPENAI_API_KEY: "sk-should-not-be-here" });
    expect(() => loadConfig({ configPath: file, cwd: "/", env: {} })).toThrow(/OPENAI_API_KEY/);
  });

  it("has exit code 2", () => {
    expect(new ConfigError("x").exitCode).toBe(2);
  });
});

describe("secrets", () => {
  it("requireSecrets names every missing key", () => {
    expect(() => requireSecrets(["OPENAI_API_KEY", "E2B_API_KEY"], { E2B_API_KEY: "x".repeat(10) })).toThrow(
      /OPENAI_API_KEY/,
    );
    expect(() => requireSecrets(["OPENAI_API_KEY"], { OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/);
    expect(() => requireSecrets([], {})).not.toThrow();
  });

  it("loadEnvFile merges a sibling .env.local without mutating process.env", () => {
    const { dir, file } = setup({}, "OPENAI_API_KEY=sk-from-file\n");
    const cfg = loadConfig({ configPath: file, cwd: dir, env: {} });
    const before = process.env.OPENAI_API_KEY;
    const env = loadEnvFile(cfg, { E2B_API_KEY: "e2b-value" });
    expect(env.OPENAI_API_KEY).toBe("sk-from-file");
    expect(env.E2B_API_KEY).toBe("e2b-value");
    expect(process.env.OPENAI_API_KEY).toBe(before);
  });

  it("also reads the executor's qa-env/.env.local, at the lowest priority", () => {
    const { dir, file } = setup({}, "A=from-dotenv\n");
    mkdirSync(path.join(dir, "qa-env"));
    writeFileSync(path.join(dir, "qa-env", ".env.local"), "A=from-qa-env\nE2E_BASE_URL=https://only-in-qa-env.test\n");
    const cfg = loadConfig({ configPath: file, cwd: dir, env: {} });
    const env = loadEnvFile(cfg, { B: "from-env" });
    expect(env.E2E_BASE_URL).toBe("https://only-in-qa-env.test");
    expect(env.A).toBe("from-dotenv");
    expect(loadEnvFile(cfg, { A: "from-env" }).A).toBe("from-env");
  });

  it("real environment wins over .env.local", () => {
    const { dir, file } = setup({}, "OPENAI_API_KEY=from-file\n");
    const cfg = loadConfig({ configPath: file, cwd: dir, env: {} });
    expect(loadEnvFile(cfg, { OPENAI_API_KEY: "from-env" }).OPENAI_API_KEY).toBe("from-env");
  });
});
