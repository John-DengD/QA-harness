import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Acceptance } from "../src/contracts/acceptance";
import { Case, CasesFile } from "../src/contracts/cases";
import { CaseReviewEntry } from "../src/contracts/case-review";
import { CaseResult, Verdict } from "../src/contracts/result";
import { writeArtifact } from "../src/run-dir";

const goodCase = {
  id: "C1",
  title: "t",
  generator: "G1",
  type: "happy",
  expected: { text: "x", sourceRef: "ticket:HEL-1", anchor: "verbatim" },
  preconditions: [],
  risk: "r",
  testability: { state: "ready" },
};

describe("contracts", () => {
  it("rejects a case without expected.anchor", () => {
    const { anchor: _a, ...expected } = goodCase.expected;
    expect(Case.safeParse({ ...goodCase, expected }).success).toBe(false);
    expect(Case.safeParse(goodCase).success).toBe(true);
  });
  it("rejects an empty anchor and an unknown generator", () => {
    expect(Case.safeParse({ ...goodCase, expected: { ...goodCase.expected, anchor: "" } }).success).toBe(false);
    expect(Case.safeParse({ ...goodCase, generator: "G9" }).success).toBe(false);
  });
  it("Blocked testability needs a reason", () => {
    expect(Case.safeParse({ ...goodCase, testability: { state: "Blocked" } }).success).toBe(false);
    expect(Case.safeParse({ ...goodCase, testability: { state: "Blocked", reason: "needs org-B" } }).success).toBe(true);
  });
  it("rejects a review entry with an empty reason", () => {
    expect(CaseReviewEntry.safeParse({ caseId: "C1", verdict: "drop", reason: "" }).success).toBe(false);
    expect(CaseReviewEntry.safeParse({ caseId: "C1", verdict: "keep", reason: "ok" }).success).toBe(true);
    expect(CaseReviewEntry.safeParse({ caseId: "C1", verdict: "maybe", reason: "ok" }).success).toBe(false);
  });
  it("knows exactly the six spec verdicts", () => {
    expect(Verdict.options).toEqual(["Pass", "ProductFail", "Blocked", "Inconclusive", "NotApplicable", "Automation failure"]);
    expect(CaseResult.safeParse({ caseId: "C1", verdict: "Pass", generated: false, evidenceDir: "e" }).success).toBe(true);
  });
  it("acceptance atoms need sourceRef and anchor", () => {
    expect(Acceptance.safeParse({ atoms: [{ id: "A1", text: "t", sourceRef: "s", anchor: "" }] }).success).toBe(false);
  });
});

describe("writeArtifact", () => {
  it("validates before writing: invalid data leaves no file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-art-"));
    expect(() => writeArtifact(dir, "cases.json", { cases: [{ id: "C1" }] })).toThrow();
    expect(existsSync(path.join(dir, "cases.json"))).toBe(false);
  });
  it("writes valid data as JSON", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-art-"));
    writeArtifact(dir, "cases.json", CasesFile.parse({ cases: [goodCase] }));
    expect(JSON.parse(readFileSync(path.join(dir, "cases.json"), "utf8")).cases[0].id).toBe("C1");
  });
  it("writes per-case results under results/", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-art-"));
    writeArtifact(dir, "results/C1.json", { caseId: "C1", verdict: "Pass", generated: false, evidenceDir: "e" });
    expect(existsSync(path.join(dir, "results/C1.json"))).toBe(true);
  });
  it("refuses unknown artifact names", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-art-"));
    expect(() => writeArtifact(dir, "whatever.json", {})).toThrow(/unknown artifact/);
  });
});
