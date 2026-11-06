import { describe, expect, it } from "vitest";

import { runStage, stageError } from "../../src/tools/stages";

describe("runStage", () => {
  it("adds the current stage to an unlabelled failure", async () => {
    await expect(
      runStage("login", async () => {
        throw new Error("form did not submit");
      })
    ).rejects.toThrow("[stage:login] form did not submit");
  });

  it("preserves an existing stage label", async () => {
    const error = stageError("signup", "verification failed");
    await expect(
      runStage("login", async () => {
        throw error;
      })
    ).rejects.toBe(error);
  });
});
