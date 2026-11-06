import { describe, expect, it } from "vitest";

import {
  InvocationIdentityError,
  finalizeSharedActionEvidence,
  invocationReuseOutcome,
  resolveInvocationCaseId,
  sharedActionExitCode,
  sharedActionNextStep,
} from "../../src/tools/shared-action-evidence";

it("returns a failing CLI exit code for every incomplete evidence status", () => {
  expect(sharedActionExitCode("completed")).toBe(0);
  expect(sharedActionExitCode("failed")).toBe(1);
  expect(sharedActionExitCode("action_unknown")).toBe(1);
});

it("preserves side-effect uncertainty when after-action capture fails", async () => {
  const capture = async () => { throw new Error("capture disconnected"); };
  expect(await finalizeSharedActionEvidence("reversible", null, capture)).toEqual({
    status: "action_unknown", afterCaptured: false,
    error: "After-action evidence capture failed; inspect the live state before retry",
  });
  expect(await finalizeSharedActionEvidence("read", null, capture)).toMatchObject({
    status: "failed", afterCaptured: false,
  });
});

it("records a failed or timed-out irreversible Action as action_unknown, never as a plain failure", async () => {
  expect(await finalizeSharedActionEvidence("irreversible", "submit timed out",
    async () => { throw new Error("capture disconnected"); })).toEqual({
    status: "action_unknown", error: "submit timed out", afterCaptured: false,
  });
  expect(await finalizeSharedActionEvidence("irreversible", "click failed", async () => {})).toMatchObject({
    status: "action_unknown", afterCaptured: true,
  });
  expect(await finalizeSharedActionEvidence("read", "left the origin", async () => {})).toMatchObject({
    status: "failed",
  });
  expect(await finalizeSharedActionEvidence("read", null, async () => {})).toEqual({
    status: "completed", error: null, afterCaptured: true,
  });
});

it("tells the operator to check read-only before any retry of an uncertain Action", () => {
  expect(sharedActionNextStep("completed", "irreversible", null)).toBeNull();
  expect(sharedActionNextStep("failed", "read", null)).toMatch(/retry/i);
  expect(sharedActionNextStep("action_unknown", "irreversible", null)).toMatch(/read-only.*do not re-send/is);
  expect(sharedActionNextStep("action_unknown", "reversible", "switchDraftBackFromTraffic"))
    .toMatch(/switchDraftBackFromTraffic/);
});

describe("Action invocation identity and reuse outcome", () => {
  it("accepts case-<N>, a Case key or a reserved setup/cleanup phase, and explains anything else", () => {
    expect(resolveInvocationCaseId({ caseDir: "/run/evidence/case-3" })).toBe("case-3");
    expect(resolveInvocationCaseId({ caseDir: "/run/evidence/_prep", phase: "setup" })).toBe("setup");
    expect(resolveInvocationCaseId({ caseDir: "/run/evidence/cleanup" })).toBe("cleanup");
    expect(resolveInvocationCaseId({ caseDir: "/run/evidence/x", caseId: "tracking.waiting.copy" })).toBe("tracking.waiting.copy");
    expect(() => resolveInvocationCaseId({ caseDir: "/run/evidence/_prep" })).toThrow(InvocationIdentityError);
    expect(() => resolveInvocationCaseId({ caseDir: "/run/evidence/_prep" })).toThrow(/--phase setup/);
    expect(() => resolveInvocationCaseId({ caseDir: "/run/evidence/x", phase: "teardown" })).toThrow(/--phase must be setup or cleanup/);
    expect(() => resolveInvocationCaseId({ caseDir: "/run/evidence/x", phase: "setup", caseId: "case-1" }))
      .toThrow(/either --phase setup or a Case/);
    const error = (() => { try { resolveInvocationCaseId({ caseDir: "/r/_prep" }); } catch (e) { return e; } })();
    expect((error as InvocationIdentityError).toJSON()).toMatchObject({ error: "invalid_case_id", allowed: expect.any(Array) });
  });

  it("logs a hit only for a clean, trusted run; a read that tripped the guard waits for its cross-check", () => {
    expect(invocationReuseOutcome({ status: "completed", verifyOnly: false, crossCheck: false })).toBe("hit");
    expect(invocationReuseOutcome({ status: "completed", verifyOnly: false, crossCheck: true })).toBe("pending_crosscheck");
    expect(invocationReuseOutcome({ status: "completed", verifyOnly: true, crossCheck: false })).toBeNull();
    expect(invocationReuseOutcome({ status: "failed", verifyOnly: false, crossCheck: false })).toBeNull();
  });
});
