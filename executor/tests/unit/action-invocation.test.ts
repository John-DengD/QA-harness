import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalInvocationJson,
  sha256Bytes,
  validateActionInvocationFact,
} from "../../src/tools/action-invocation";

function fact(overrides: Record<string, unknown>) {
  const invocationId = randomUUID();
  const body: Record<string, unknown> = {
    kind: "action-invocation", schemaVersion: 2, invocationId, runId: "run-1", caseId: "case-1",
    intentId: "switch", action: "confirmSwitchToTraffic", domain: "google-tracking", sandboxId: "sandbox1",
    origin: "https://qa.example.test", rollback: "reversible", undoneBy: "switchDraftBackFromTraffic",
    intent: "把草稿切到 Traffic", status: "completed",
    startedAt: "2026-10-14T01:00:00Z", finishedAt: "2026-10-14T01:00:01Z", lookupMs: 1, executionMs: 2,
    factPath: `playwright/actions/${invocationId}.json`,
    beforeScreenshot: `${invocationId}-before.png`, afterScreenshot: `${invocationId}-after.png`,
    target: { origin: "https://qa.example.test", beforeScreenshot: `playwright/actions/${invocationId}-before.png`,
      afterScreenshot: `playwright/actions/${invocationId}-after.png` },
    fact: { ok: true }, error: null,
    ...overrides,
  };
  for (const [key, value] of Object.entries(body)) if (value === undefined) delete body[key];
  return { ...body, integrityHash: sha256Bytes(canonicalInvocationJson(body)) };
}

describe("Action invocation facts", () => {
  it("records the rollback level and undo Action from the Action table", () => {
    expect(validateActionInvocationFact(fact({}))).toMatchObject({
      schemaVersion: 2, rollback: "reversible", undoneBy: "switchDraftBackFromTraffic", intent: "把草稿切到 Traffic",
    });
    const unknown = fact({ rollback: "irreversible", undoneBy: null, status: "action_unknown", error: "timed out" });
    expect(validateActionInvocationFact(unknown)).toMatchObject({ rollback: "irreversible", undoneBy: null, status: "action_unknown" });
  });

  it("rejects an unknown rollback level and the caller-supplied sideEffect in a new fact", () => {
    expect(() => validateActionInvocationFact(fact({ rollback: "side_effect" }))).toThrow(/rollback/);
    expect(() => validateActionInvocationFact(fact({ rollback: undefined, sideEffect: "read" }))).toThrow(/rollback/);
  });

  it("still reads old schemaVersion 1 facts, mapping side_effect to irreversible", () => {
    for (const [sideEffect, rollback] of [["read", "read"], ["reversible", "reversible"], ["side_effect", "irreversible"]]) {
      const old = fact({ schemaVersion: 1, sideEffect, rollback: undefined, undoneBy: undefined, intent: undefined });
      expect(validateActionInvocationFact(old), sideEffect).toMatchObject({ schemaVersion: 1, rollback, undoneBy: null });
    }
    expect(() => validateActionInvocationFact(fact({ schemaVersion: 1, sideEffect: "irreversible_high_impact",
      rollback: undefined, undoneBy: undefined, intent: undefined }))).toThrow(/sideEffect/);
  });
});
