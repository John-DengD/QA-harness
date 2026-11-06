import { describe, expect, it } from "vitest";
import { checkSilentDrift, factShape } from "../../src/tools/silent-drift";
import { applyHealthOutcome } from "../../src/tools/action-health";

const stamp = { at: "2026-10-14T00:00:00Z", runId: "run-1", environment: "app-staging.hellyeahai.com", productSha: null, codeHash: "abc123abc123" };

describe("factShape", () => {
  it("marks false, 0, empty string, empty collections and null as empty", () => {
    expect(factShape({ visible: false, count: 0, title: "", items: [], meta: {}, missing: null, cards: 6, label: "Ads", on: true }))
      .toEqual({ visible: "empty", count: "empty", title: "empty", items: "empty", meta: "empty", missing: "empty",
        cards: "filled", label: "filled", on: "filled" });
  });

  it("flattens one nested level so readiness-style facts are compared field by field", () => {
    expect(factShape({ readiness: { row: "required", summary: "" } })).toEqual({ "readiness.row": "filled", "readiness.summary": "empty" });
  });

  it("returns no shape for a non-object fact", () => {
    expect(factShape(null)).toEqual({});
    expect(factShape("text")).toEqual({});
  });
});

describe("checkSilentDrift", () => {
  it("asks for a cross-check when every reading is empty", () => {
    const result = checkSilentDrift({ controlsVisible: false, searchVisible: false });
    expect(result.crossCheck).toBe(true);
    expect(result.reasons[0]).toMatch(/全部读数为空/);
  });

  it("asks for a cross-check when a mustHaveValue field is empty, without comparing with earlier readings", () => {
    // The Studio rename: the grid rendered, the card locator matched nothing, the call did not fail.
    const result = checkSilentDrift({ cardCount: 0, generatingCardCount: 0, heading: "Ads" }, { mustHaveValue: ["cardCount"] });
    expect(result.crossCheck).toBe(true);
    expect(result.reasons).toEqual(["cardCount 应有值，这次为空"]);
    expect(checkSilentDrift({ strategy: { goal: "Sales", bidding: "" } }, { mustHaveValue: ["strategy.bidding"] }).reasons)
      .toEqual(["strategy.bidding 应有值，这次为空"]);
  });

  it("asks for a cross-check when an enumerated field reads a value outside allowedValues", () => {
    // PR-1327: the missing card's chip became "Not set up", so the reader fell through to unrecognized.
    const result = checkSilentDrift(
      { cardState: "unrecognized", readiness: { conversionTrackingRow: "required" } },
      { mustHaveValue: ["cardState"], allowedValues: { cardState: ["missing", "waiting", "live", "traffic", "absent"],
        "readiness.conversionTrackingRow": ["required", "not connected", "unconfirmed", "absent"] } },
    );
    expect(result).toEqual({ crossCheck: true, reasons: ["cardState 取值 unrecognized 不在合法取值内（missing, waiting, live, traffic, absent）"] });
  });

  it("stays quiet for an ordinary reading, including legitimately empty fields that are not required", () => {
    expect(checkSilentDrift({ cardCount: 6, generatingCardCount: 0 }, { mustHaveValue: ["cardCount"] }))
      .toEqual({ crossCheck: false, reasons: [] });
    expect(checkSilentDrift({ summaryText: "$0.00", transactionRows: [] }, { mustHaveValue: ["summaryText"] }))
      .toEqual({ crossCheck: false, reasons: [] });
    expect(checkSilentDrift({ cardState: "waiting", conversionLoopLastStep: null },
      { allowedValues: { cardState: ["waiting"], conversionLoopLastStep: ["waiting"] } })).toEqual({ crossCheck: false, reasons: [] });
    expect(checkSilentDrift({ cards: 6 })).toEqual({ crossCheck: false, reasons: [] });
  });

  it("does not judge a fact with no fields", () => {
    expect(checkSilentDrift({})).toEqual({ crossCheck: false, reasons: [] });
  });
});

describe("health without a silent-drift baseline", () => {
  it("no longer stores reading shapes and ignores the retired lastHealthyShape of older files", () => {
    const legacy = { schemaVersion: 1 as const, actions: { observeStudioLibraryRuns: {
      status: "healthy" as const, consecutiveFailures: 0, lastVerified: null, lastFailure: null,
      lastHealthyShape: { cards: "filled" },
    } } };
    const next = applyHealthOutcome(legacy, { action: "observeStudioLibraryRuns", kind: "completed", stamp });
    expect(next.actions.observeStudioLibraryRuns.status).toBe("healthy");
    expect(next.actions.observeStudioLibraryRuns).not.toHaveProperty("lastHealthyShape");
  });
});

describe("drift sentinels: the Action itself says it did not recognize the page", () => {
  it("flags a declared sentinel value as sentinel drift, ahead of the generic allowedValues reason", async () => {
    const { SENTINEL_REASON_PREFIX, isSentinelReason } = await import("../../src/tools/silent-drift");
    // PR-1327 r-20261015-1415 case-2: readGoogleTrackingReadiness returned cardState="unrecognized".
    const fact = { cardState: "unrecognized", conversionLoopLastStep: "not set up", setupLinkVisible: true,
      readiness: { conversionTrackingRow: "required", summary: "2 things to fix before you can launch." } };
    const result = checkSilentDrift(fact, {
      mustHaveValue: ["cardState"],
      allowedValues: { cardState: ["missing", "waiting", "live", "traffic", "absent"] },
      driftSentinels: { cardState: ["unrecognized"], "readiness.conversionTrackingRow": ["unrecognized"] },
    });
    expect(result.crossCheck).toBe(true);
    expect(result.sentinel).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].startsWith(SENTINEL_REASON_PREFIX)).toBe(true);
    expect(result.reasons[0]).toContain("cardState");
    expect(isSentinelReason(result.reasons[0])).toBe(true);
  });

  it("does not flag a sentinel for ordinary values", () => {
    const result = checkSilentDrift({ cardState: "missing", readiness: { conversionTrackingRow: "required" } },
      { driftSentinels: { cardState: ["unrecognized"], "readiness.conversionTrackingRow": ["unrecognized"] } });
    expect(result.crossCheck).toBe(false);
    expect(result.sentinel).toBeFalsy();
  });

  it("maps an invocation to its health transition: sentinel drift marks suspected_drift, a pending cross-check waits", async () => {
    const { invocationHealthKind } = await import("../../src/tools/silent-drift");
    expect(invocationHealthKind({ status: "completed", driftSuspected: false, silentDrift: { crossCheck: false, reasons: [] } })).toBe("completed");
    expect(invocationHealthKind({ status: "completed", driftSuspected: false, silentDrift: { crossCheck: true, reasons: ["x"] } })).toBeNull();
    expect(invocationHealthKind({ status: "completed", driftSuspected: false,
      silentDrift: { crossCheck: true, sentinel: true, reasons: ["x"] } })).toBe("sentinel_drift");
    expect(invocationHealthKind({ status: "failed", driftSuspected: true, silentDrift: { crossCheck: false, reasons: [] } })).toBe("drift");
    expect(invocationHealthKind({ status: "failed", driftSuspected: false, silentDrift: { crossCheck: false, reasons: [] } })).toBeNull();
  });
});
