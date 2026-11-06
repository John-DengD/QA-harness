import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  assertionRowHash,
  checkSpecAssertionRefs,
  collectAssertionRows,
  loadAssertionRows,
  specAssertionRefs,
} from "../../src/tools/assertion-refs";

const MODULE = `---
id: hellyeah.wallet-payment
status: pilot
---

## Assertions

| ID | Type | Applies when | Expected |
|---|---|---|---|
| WALLET-012 | state_transition | 冲正成功 | 原 top-up 保留并转为 REVERSED |
| WALLET-013 | amount_delta | 冲正成功 | 新增 REVERSAL 负额记录 |
`;

describe("collectAssertionRows", () => {
  it("reads assertion rows with their module status", () => {
    const rows = collectAssertionRows([{ file: "wallet-payment.md", text: MODULE }]);
    expect(rows.get("WALLET-012")).toMatchObject({ file: "wallet-payment.md", status: "pilot" });
    expect(rows.get("WALLET-012")?.row).toContain("转为 REVERSED");
    expect(rows.size).toBe(2);
  });
});

describe("specAssertionRefs", () => {
  it("finds @assert tags in a spec", () => {
    const spec = `test("S1 reversal", { tag: ["@case:s1", "@assert:WALLET-012", "@assert:WALLET-013"] }, async () => {});`;
    expect(specAssertionRefs(spec)).toEqual(["WALLET-012", "WALLET-013"]);
  });
});

describe("checkSpecAssertionRefs", () => {
  const rows = collectAssertionRows([{ file: "wallet-payment.md", text: MODULE }]);
  const specs = [{ file: "cases/18.spec.ts", text: `tag: ["@assert:WALLET-012"]` }];
  const lock = { "WALLET-012": assertionRowHash(rows.get("WALLET-012")!.row) };

  it("passes when the cited assertion exists, is not demoted and is unchanged", () => {
    expect(checkSpecAssertionRefs(specs, rows, lock)).toEqual([]);
  });

  it("flags a spec citing an assertion that does not exist", () => {
    const problems = checkSpecAssertionRefs([{ file: "cases/18.spec.ts", text: `"@assert:WALLET-099"` }], rows, {});
    expect(problems).toEqual([expect.stringMatching(/cases\/18\.spec\.ts.*WALLET-099.*不存在/)]);
  });

  it("flags a spec whose assertion changed since it was written", () => {
    const changed = collectAssertionRows([{ file: "wallet-payment.md", text: MODULE.replace("转为 REVERSED", "被删除") }]);
    expect(checkSpecAssertionRefs(specs, changed, lock)).toEqual([expect.stringMatching(/WALLET-012.*已修改.*spec 待更新/)]);
  });

  it("flags a spec whose assertion's module was demoted to needs-review", () => {
    const demoted = collectAssertionRows([{ file: "wallet-payment.md", text: MODULE.replace("status: pilot", "status: needs-review") }]);
    expect(checkSpecAssertionRefs(specs, demoted, lock)).toEqual([expect.stringMatching(/WALLET-012.*needs-review.*spec 待更新/)]);
  });

  it("flags a cited assertion with no lock entry", () => {
    expect(checkSpecAssertionRefs(specs, rows, {})).toEqual([expect.stringMatching(/WALLET-012.*未记录.*spec:assert-lock/)]);
  });
});

describe("this repository", () => {
  it("every @assert in release specs is current", async () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const { rows, specs, lock } = await loadAssertionRows(root);
    expect(checkSpecAssertionRefs(specs, rows, lock)).toEqual([]);
  });
});
