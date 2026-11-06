import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

it("CLI status policy returns nonzero for failed and uncertain evidence", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const probe = [
    'import { sharedActionExitCode } from "./scripts/e2b-action.ts";',
    'if (sharedActionExitCode("completed") !== 0) process.exit(1);',
    'if (sharedActionExitCode("failed") === 0) process.exit(2);',
    'if (sharedActionExitCode("action_unknown") === 0) process.exit(3);',
  ].join("\n");
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e", probe,
  ], { cwd: root, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
});

describe("shared execution policy at the CLI", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  // No --side-effect: the rollback level comes from the Action table.
  const run = (dir: string, action: string, argsJson: string, extra: string[] = [], target = ["--action", action]) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/e2b-action.ts",
      "--sandbox-id", "fakesandbox", "--case-dir", path.join(dir, "cases", "C1"),
      "--origin", "https://app-staging.hellyeahai.com", ...target,
      "--args-json", argsJson, ...extra,
      "--reuse-log", path.join(dir, "reuse", "action-reuse.jsonl"), "--run-id", "run-1"], {
      // A dummy key: any attempt to reach E2B would fail with an auth error instead.
      cwd: root, encoding: "utf8", env: { ...process.env, E2B_API_KEY: "e2b_test_dummy" }, timeout: 60_000,
    });

  async function fixture(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "e2b-action-policy-"));
    await mkdir(path.join(dir, "reuse"), { recursive: true });
    await mkdir(path.join(dir, "cases", "C1", "computer-use"), { recursive: true });
    await writeFile(path.join(dir, "reuse", "action-reuse.jsonl"), `${JSON.stringify({
      kind: "preflight", runId: "run-1", createdAt: new Date().toISOString(), indexedActions: 1, hotCandidates: [],
    })}\n`);
    await writeFile(path.join(dir, "cases", "C1", "computer-use", "recording.json"), JSON.stringify({
      sandboxId: "fakesandbox", pid: 1, remotePath: "/tmp/x.mp4", startedAt: new Date().toISOString(),
    }));
    return dir;
  }

  it("refuses a denied Action with its reason before touching the reuse log or E2B", async () => {
    // No fixture: the reuse log and recording do not even exist.
    const result = run(path.join(tmpdir(), "no-such-run"), "signInAdmin", '["a@example.test","pw"]');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/signInAdmin is denied for shared E2B execution/);
    expect(result.stderr).toMatch(/signInAdminFromEnv/);
    expect(result.stderr).not.toMatch(/ENOENT|unauthori[sz]ed|401|recording/i);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("refuses the removed --side-effect flag with an explanation, before touching anything", async () => {
    // No fixture: rejection must happen before the reuse log or recording is read.
    for (const level of ["read", "irreversible_high_impact"]) {
      const result = run(path.join(tmpdir(), "no-such-run"), "observeStudioLibraryControls", "[]", ["--side-effect", level]);
      expect(result.status, level).toBe(2);
      expect(result.stderr, level).toMatch(/--side-effect was removed/);
      expect(result.stderr, level).toMatch(/action-catalog\.json/);
      expect(result.stderr, level).not.toMatch(/ENOENT|recording/i);
    }
  });

  it("accepts the drift-loop flags and still refuses an empty --product-sha before E2B", async () => {
    const result = run(path.join(tmpdir(), "no-such-run"), "observeStudioLibraryControls", "[]",
      ["--verify-only", "--qa-root", tmpdir(), "--product-sha", "bad sha"]);
    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(/Unknown option/);
    expect(result.stderr).toMatch(/--product-sha/);
  });

  it("refuses an Action that has no row in the Action table", async () => {
    const result = run(path.join(tmpdir(), "no-such-run"), "noSuchAction", "[]");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/noSuchAction has no row in the Action table/);
  });

  it("runs by intent: resolves the table intent to its Action without --side-effect", async () => {
    const dir = await fixture();
    try {
      const result = run(dir, "", '["extra"]', [], ["--intent", "读取 Studio 素材库的筛选与搜索控件"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("observeStudioLibraryControls accepts at most 0 argument(s)");
      const unknown = run(dir, "", "[]", [], ["--intent", "做一件表里没有的事"]);
      expect(unknown.status).toBe(2);
      expect(unknown.stderr).toMatch(/No Action in the table has the intent/);
      const both = run(dir, "openCampaignList", "[]", [], ["--action", "openCampaignList", "--intent", "把草稿切到 Traffic"]);
      expect(both.status).toBe(2);
      expect(both.stderr).toMatch(/resolves to confirmSwitchToTraffic, not openCampaignList/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("answers an illegal Case identity in JSON and accepts --phase setup|cleanup for non-Case calls", async () => {
    const dir = await fixture();
    try {
      const prep = (extra: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/e2b-action.ts",
        "--sandbox-id", "fakesandbox", "--case-dir", path.join(dir, "cases", "_prep"),
        "--origin", "https://app-staging.hellyeahai.com", "--action", "observeStudioLibraryControls",
        "--args-json", '["extra"]', ...extra,
        "--reuse-log", path.join(dir, "reuse", "action-reuse.jsonl"), "--run-id", "run-1"], {
        cwd: root, encoding: "utf8", env: { ...process.env, E2B_API_KEY: "e2b_test_dummy" }, timeout: 60_000,
      });
      const refused = prep([]);
      expect(refused.status).toBe(2);
      expect(JSON.parse(refused.stdout.trim())).toMatchObject({ error: "invalid_case_id", value: "_prep" });
      expect(JSON.parse(prep(["--phase", "teardown"]).stdout.trim())).toMatchObject({ error: "invalid_case_id" });
      // A legal phase passes the identity check and stops later, at the argument bound, before E2B.
      await mkdir(path.join(dir, "cases", "_prep", "computer-use"), { recursive: true });
      await writeFile(path.join(dir, "cases", "_prep", "computer-use", "recording.json"), JSON.stringify({
        sandboxId: "fakesandbox", pid: 1, remotePath: "/tmp/x.mp4", startedAt: new Date().toISOString(),
      }));
      const setup = prep(["--phase", "setup"]);
      expect(setup.status).toBe(2);
      expect(setup.stdout).not.toContain("invalid_case_id");
      expect(setup.stderr).toContain("observeStudioLibraryControls accepts at most 0 argument(s)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("bounds an Action with no fixed argument count by its formal parameters before connecting", async () => {
    const dir = await fixture();
    try {
      const result = run(dir, "observeStudioLibraryControls", '["extra"]');
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("observeStudioLibraryControls accepts at most 0 argument(s)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
