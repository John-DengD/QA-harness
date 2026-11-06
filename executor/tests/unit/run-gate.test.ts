import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertRegisteredRun, executionPhaseHint } from "../../src/loop/run-gate";
import { checkpointRun, initRun, type RunIdentity } from "../../src/loop/state";

const roots: string[] = [];
const at = (time: string) => new Date(time);

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qa-run-gate-"));
  roots.push(root);
  return root;
}

async function register(root: string, runRoot: string, runId: string) {
  await mkdir(path.join(root, runRoot, "run-state"), { recursive: true });
  await writeFile(path.join(root, runRoot, "run-state", "ticket-task-model.md"), "# QA-1149\n");
  const identity: RunIdentity = {
    runId, runRoot, journeyKey: "google-tracking-launch", mode: "new",
    scope: { feature: "PR-1217", environment: "staging", role: "customer", orgAlias: "qa-1", deploymentSha: "a868f1f" },
    executorId: "agent-1",
  };
  return initRun(root, identity, { taskModel: `${runRoot}/run-state/ticket-task-model.md` }, at("2026-10-14T10:00:00Z"));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("assertRegisteredRun", () => {
  it("uses the nearest .qa-loop registry when QA_ROOT is a nested product directory", async () => {
    const workspaceRoot = await workspace();
    const qaRoot = path.join(workspaceRoot, "Hellyeah", "User-Dashboard-test");
    await mkdir(path.join(workspaceRoot, ".qa-loop", "runs"), { recursive: true });
    await register(qaRoot, "PR-1217/runs/run-1", "run-1");
    const run = await assertRegisteredRun(path.join(qaRoot, "PR-1217", "runs", "run-1", "evidence", "C1"));
    expect(run?.runId).toBe("run-1");
  });

  it("registers runs grouped under a surface directory of QA_ROOT", async () => {
    const root = await workspace();
    const runRoot = "User-Dashboard-test/PR-1217/runs/run-1";
    await register(root, runRoot, "run-1");
    const run = await assertRegisteredRun(path.join(root, runRoot, "evidence", "C1"));
    expect(run?.runRoot).toBe(runRoot);
    await expect(register(root, "User-Dashboard-test/PR-1273/runs/run-2", "run-2")).rejects.toThrow(/runRoot must identify/);
    await expect(register(root, "../PR-1217/runs/run-3", "run-3")).rejects.toThrow();
  });

  it("rejects evidence of a run that was never registered", async () => {
    const root = await workspace();
    await register(root, "PR-1217/runs/run-1", "run-1");
    await mkdir(path.join(root, "PR-1217", "runs", "run-2", "evidence", "C1"), { recursive: true });
    await expect(assertRegisteredRun(path.join(root, "PR-1217", "runs", "run-2", "evidence", "C1")))
      .rejects.toThrow(/loop:state -- init/);
  });

  it("rejects evidence outside a runs/<runId> directory", async () => {
    const root = await workspace();
    await expect(assertRegisteredRun(path.join(root, "PR-1217", "evidence", "C1")))
      .rejects.toThrow(/runs\/<runId>/);
  });

  it("rejects a registered run that is already awaiting review", async () => {
    const root = await workspace();
    const runRoot = "PR-1217/runs/run-1";
    await register(root, runRoot, "run-1");
    await checkpointRun(root, "run-1", "agent-1", "executing", {}, at("2026-10-14T10:01:00Z"));
    await checkpointRun(root, "run-1", "agent-1", "awaiting_review", {}, at("2026-10-14T10:02:00Z"));
    await expect(assertRegisteredRun(path.join(root, runRoot, "evidence", "C1")))
      .rejects.toThrow(/awaiting_review/);
  });

  it("can be bypassed only by the shared-browser smoke tool", async () => {
    const root = await workspace();
    const caseDir = path.join(root, "smoke", "evidence", "shared-browser");
    await expect(assertRegisteredRun(caseDir, { QA_LOOP_GATE: "smoke" })).resolves.toBeNull();
    await expect(assertRegisteredRun(caseDir, { QA_LOOP_GATE: "off" })).rejects.toThrow(/runs\/<runId>/);
  });
});

it("tells record-start callers to checkpoint executing while the run is still planned", () => {
  const run = { runId: "run-1", executorId: "agent-1", phase: "planned" } as Parameters<typeof executionPhaseHint>[0];
  expect(executionPhaseHint(run)).toMatch(/--phase executing/);
  expect(executionPhaseHint({ ...run!, phase: "executing" })).toBeNull();
  expect(executionPhaseHint(null)).toBeNull();
});
