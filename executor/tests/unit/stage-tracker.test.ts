import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { StageTracker } from "../../src/tools/stage-tracker";

describe("StageTracker", () => {
  it("persists passed and failed stage results after each stage", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hy-e2e-stages-"));
    const output = path.join(dir, "stages.json");
    const tracker = new StageTracker(output);

    await tracker.run("login", async () => undefined);
    await expect(
      tracker.run("wallet-topup", async () => {
        throw new Error("payment declined");
      })
    ).rejects.toThrow("[stage:wallet-topup]");

    const stages = JSON.parse(await readFile(output, "utf8"));
    expect(stages).toMatchObject([
      { name: "login", status: "passed" },
      {
        error: "[stage:wallet-topup] payment declined",
        failureType: "product",
        name: "wallet-topup",
        status: "failed",
      },
    ]);
  });
});
