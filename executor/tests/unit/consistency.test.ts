import { describe, expect, it } from "vitest";

import { classifyConsistency } from "../../src/tools/consistency";

describe("classifyConsistency", () => {
  it.each([
    [false, false, "CONSISTENT_PASS"],
    [true, false, "API_FAIL_UI_PASS"],
    [false, true, "API_PASS_UI_FAIL"],
    [true, true, "BOTH_FAIL"],
  ] as const)("classifies API=%s UI=%s", (apiFailed, uiFailed, expected) => {
    expect(classifyConsistency(apiFailed, uiFailed)).toBe(expected);
  });
});
