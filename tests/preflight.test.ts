import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPreflight } from "../src/commands/run";

const EVARS = { E2E_ACCOUNT_EMAIL: "a@b.test", CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_x" };
function layout(opts: { modules?: boolean; envFile?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "qa-pf-"));
  const executor = path.join(root, "executor");
  mkdirSync(executor, { recursive: true });
  if (opts.modules !== false) mkdirSync(path.join(executor, "node_modules"));
  if (opts.envFile !== false) { mkdirSync(path.join(root, "qa-env")); writeFileSync(path.join(root, "qa-env", ".env.local"), ""); }
  return executor;
}

describe("runPreflight", () => {
  it("is empty when everything the run stage needs is present", () => {
    expect(runPreflight({ executorRoot: layout(), env: EVARS })).toEqual([]);
  });
  it("names the missing executor dependencies, env file and variables", () => {
    const problems = runPreflight({ executorRoot: layout({ modules: false, envFile: false }), env: { E2E_ACCOUNT_EMAIL: "a@b.test" } }).join("\n");
    expect(problems).toContain("node_modules");
    expect(problems).toContain("qa-env/.env.local");
    expect(problems).toContain("CLERK_PUBLISHABLE_KEY");
    expect(problems).toContain("CLERK_SECRET_KEY");
    expect(problems).not.toContain("E2E_ACCOUNT_EMAIL");
  });
  it("treats an empty variable as missing", () => {
    expect(runPreflight({ executorRoot: layout(), env: { ...EVARS, E2E_ACCOUNT_EMAIL: " " } }).join()).toContain("E2E_ACCOUNT_EMAIL");
  });
});
