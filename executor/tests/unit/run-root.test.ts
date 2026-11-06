import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseRunRoot, qaRelativeRunRoot, resolveQaRootForRun, runRootOfRef } from "../../src/loop/run-root";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("run root rule shared by every loop tool", () => {
  it("accepts the old layout and a surface prefix, and derives the feature root", () => {
    expect(parseRunRoot("PR-1217/runs/r-1", { feature: "PR-1217", runId: "r-1" }))
      .toEqual({ runRoot: "PR-1217/runs/r-1", surface: "", feature: "PR-1217", runId: "r-1", featureRoot: "PR-1217" });
    expect(parseRunRoot("User-Dashboard-test/PR-1327/runs/r-20261015-1415", { feature: "PR-1327" }))
      .toMatchObject({ surface: "User-Dashboard-test", feature: "PR-1327", runId: "r-20261015-1415",
        featureRoot: "User-Dashboard-test/PR-1327" });
  });

  it("rejects another feature, another run, traversal and malformed roots", () => {
    expect(() => parseRunRoot("User-Dashboard-test/PR-1327/runs/r-1", { feature: "PR-1273" })).toThrow(/runRoot must identify/);
    expect(() => parseRunRoot("PR-1327/runs/r-1", { runId: "r-2" })).toThrow(/runId/);
    expect(() => parseRunRoot("../PR-1327/runs/r-1")).toThrow(/runRoot must be/);
    expect(() => parseRunRoot("PR-1327/run/r-1")).toThrow(/runRoot must be/);
    expect(() => parseRunRoot("/abs/PR-1327/runs/r-1")).toThrow(/runRoot must be/);
    expect(() => parseRunRoot("a/b/c/d/e/PR-1/runs/r-1")).toThrow(/runRoot must be/);
  });

  it("finds the run root of a run file such as the human review ledger", () => {
    expect(runRootOfRef("User-Dashboard-test/PR-1327/runs/r-1/run-state/human-review.jsonl", "run-state/human-review.jsonl"))
      .toMatchObject({ runId: "r-1", feature: "PR-1327" });
    expect(runRootOfRef("PR-1327/runs/r-1/run-state/other.jsonl", "run-state/human-review.jsonl")).toBeNull();
  });

  it("resolves QA_ROOT: explicit, then env QA_ROOT around the run, then nearest .qa-loop, then three levels up", async () => {
    const qaRoot = await mkdtemp(path.join(os.tmpdir(), "qa-run-root-"));
    roots.push(qaRoot);
    const run = path.join(qaRoot, "User-Dashboard-test", "PR-1327", "runs", "r-1");
    await mkdir(run, { recursive: true });
    expect(resolveQaRootForRun(run, "/explicit", {})).toBe(path.resolve("/explicit"));
    // Without env or .qa-loop the surface layout cannot be told apart: the old rule applies.
    expect(resolveQaRootForRun(run, undefined, {})).toBe(path.join(qaRoot, "User-Dashboard-test"));
    expect(resolveQaRootForRun(run, undefined, { QA_ROOT: qaRoot })).toBe(qaRoot);
    await mkdir(path.join(qaRoot, ".qa-loop"));
    expect(resolveQaRootForRun(run, undefined, {})).toBe(qaRoot);
    expect(resolveQaRootForRun(run, undefined, { QA_ROOT: "/somewhere/else" })).toBe(qaRoot);
    expect(qaRelativeRunRoot(qaRoot, run)).toBe("User-Dashboard-test/PR-1327/runs/r-1");
  });
});
