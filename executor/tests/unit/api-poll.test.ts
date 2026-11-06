import { describe, expect, it, vi } from "vitest";

import { pollApi } from "../../src/tools/api-poll";

describe("pollApi", () => {
  it("returns attempts and final value when an async state completes", async () => {
    const read = vi
      .fn<() => Promise<{ status: string }>>()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "completed" });

    const result = await pollApi({
      isComplete: (value) => value.status === "completed",
      read,
      timeoutMs: 5_000,
    });

    expect(result.attempts).toBe(2);
    expect(result.value.status).toBe("completed");
  });

  it("fails immediately on a terminal business state", async () => {
    await expect(
      pollApi({
        describeFailure: (value) =>
          value.status === "failed" ? "business operation failed" : null,
        isComplete: () => false,
        read: () => Promise.resolve({ status: "failed" }),
        timeoutMs: 5_000,
      })
    ).rejects.toThrow("business operation failed");
  });
});
