import { executeAll } from "../src/commands";
import type { CommandContext, Stage } from "../src/commands/types";

const ctx = {} as CommandContext;
const names = ["extract", "design", "review", "run", "report"] as const;

function stages(codes: Partial<Record<(typeof names)[number], number>>, log: string[]): Stage[] {
  return names.map((name) => ({
    name,
    needs: [],
    requires: [],
    createsRunDir: false,
    run: async () => {
      log.push(name);
      return codes[name] ?? 0;
    },
  }));
}

describe("executeAll", () => {
  it("runs report even when run ends with ProductFail (10) and returns that code", async () => {
    const log: string[] = [];
    expect(await executeAll(ctx, stages({ run: 10 }, log))).toBe(10);
    expect(log).toEqual([...names]);
  });
  it("runs report after an incomplete run (20)", async () => {
    const log: string[] = [];
    expect(await executeAll(ctx, stages({ run: 20 }, log))).toBe(20);
    expect(log.at(-1)).toBe("report");
  });
  it("aborts on a config or external failure (2, 3) and skips the rest", async () => {
    for (const code of [2, 3]) {
      const log: string[] = [];
      expect(await executeAll(ctx, stages({ design: code }, log))).toBe(code);
      expect(log).toEqual(["extract", "design"]);
    }
  });
  it("aborts on any other non-zero code, such as the not-implemented placeholder 1", async () => {
    const log: string[] = [];
    expect(await executeAll(ctx, stages({ extract: 1 }, log))).toBe(1);
    expect(log).toEqual(["extract"]);
  });
  it("returns 0 when everything passes", async () => {
    expect(await executeAll(ctx, stages({}, []))).toBe(0);
  });
});
