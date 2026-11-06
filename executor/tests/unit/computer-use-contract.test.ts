import { describe, expect, it } from "vitest";

import {
  parseComputerUseAction,
  parseSideEffect,
  sanitizeActionForTrace,
  traceFailureStatus,
} from "../../src/tools/computer-use-contract";

describe("computer use action contract", () => {
  it("parses one bounded atomic action", () => {
    expect(
      parseComputerUseAction(
        JSON.stringify({ type: "click", x: 120, y: 240, count: 2 })
      )
    ).toEqual({ type: "click", x: 120, y: 240, button: "left", count: 2 });
    expect(
      parseComputerUseAction(
        JSON.stringify({ type: "scroll", direction: "down", amount: 3 })
      )
    ).toEqual({ type: "scroll", direction: "down", amount: 3 });
  });

  it("rejects unbounded or malformed actions", () => {
    expect(() =>
      parseComputerUseAction(JSON.stringify({ type: "scroll", direction: "down", amount: 0 }))
    ).toThrow(/between 1 and 100/);
    expect(() =>
      parseComputerUseAction(JSON.stringify({ type: "type-env", env: "bad-name" }))
    ).toThrow(/uppercase environment name/);
    expect(() =>
      parseComputerUseAction(JSON.stringify({ type: "complete-campaign" }))
    ).toThrow(/Unsupported computer-use action/);
  });

  it("redacts typed values from the audit trace", () => {
    expect(sanitizeActionForTrace({ type: "type", text: "private value" })).toEqual({
      type: "type",
      text: "<redacted>",
      textLength: 13,
    });
    expect(
      sanitizeActionForTrace({ type: "type-env", env: "E2E_ADMIN_PASSWORD" })
    ).toEqual({
      type: "type-env",
      env: "E2E_ADMIN_PASSWORD",
      value: "<sandbox-env>",
    });
  });

  it("turns uncertain mutating actions into action_unknown", () => {
    expect(parseSideEffect("side_effect")).toBe("side_effect");
    expect(traceFailureStatus("read")).toBe("failed");
    expect(traceFailureStatus("reversible")).toBe("action_unknown");
    expect(traceFailureStatus("side_effect")).toBe("action_unknown");
  });
});
