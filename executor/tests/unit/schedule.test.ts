import { describe, expect, it } from "vitest";

import { buildDeliveryWindow } from "../../src/tools/schedule";

describe("buildDeliveryWindow", () => {
  it("returns ten inclusive UTC delivery days", () => {
    expect(buildDeliveryWindow(new Date("2026-09-01T20:00:00.000Z"), 10)).toEqual({
      endDate: "2026-09-11",
      startDate: "2026-09-02",
    });
  });

  it("rejects an invalid delivery duration", () => {
    expect(() => buildDeliveryWindow(new Date("2026-09-01T00:00:00Z"), 0)).toThrow(
      /positive integer/
    );
  });
});
