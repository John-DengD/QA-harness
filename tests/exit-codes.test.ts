import { combineExit, ExitCode } from "../src/exit-codes";

describe("combineExit", () => {
  it("picks the lowest non-zero code", () => {
    expect(combineExit([0, 20, 10])).toBe(10);
    expect(combineExit([20, 2, 10])).toBe(2);
  });
  it("is 0 for empty or all-zero", () => {
    expect(combineExit([])).toBe(0);
    expect(combineExit([0, 0])).toBe(0);
  });
  it("exposes the spec values", () => {
    expect(ExitCode).toEqual({ OK: 0, CONFIG: 2, EXTERNAL: 3, PRODUCT_FAIL: 10, INCOMPLETE: 20 });
  });
});
