import { classifyPlaywrightReport, expectedSourceKind, mapVerdict, summaryExitCode } from "../src/run/verdict";

const report = (status: string, message?: string) => ({ suites: [{ specs: [{ tests: [{ results: [{ status, error: message ? { message } : undefined }] }] }] }] });
const modules = [
  { id: "a", path: "QA-models/hellyeah/core-journeys.md", status: "draft" as const, version: 1, lastReviewed: "x" },
  { id: "b", path: "QA-models/hellyeah/wallet-payment.md", status: "active" as const, version: 1, lastReviewed: "x" },
];

describe("classifyPlaywrightReport", () => {
  it("passed", () => expect(classifyPlaywrightReport(report("passed"), 0, false)).toEqual({ outcome: "passed" }));
  it("an expect() matcher failure is an assertion failure", () => {
    const r = classifyPlaywrightReport(report("failed", "Error: expect(locator).toHaveText(expected) failed\n\nExpected: Saved"), 1, false);
    expect(r).toMatchObject({ outcome: "failed", kind: "assertion" });
  });
  it("a test timeout is automation", () => {
    expect(classifyPlaywrightReport(report("timedOut", "Test timeout of 1200000ms exceeded."), 1, false)).toMatchObject({ kind: "automation" });
  });
  it("an action locator timeout is automation", () => {
    expect(classifyPlaywrightReport(report("failed", "Error: locator.click: Timeout 20000ms exceeded."), 1, false)).toMatchObject({ kind: "automation" });
  });
  it("our own timeout kill is automation", () => {
    expect(classifyPlaywrightReport(report("passed"), 0, true)).toMatchObject({ outcome: "failed", kind: "automation" });
  });
  it("an unparsable report with a non-zero exit is automation", () => {
    expect(classifyPlaywrightReport(null, 1, false)).toMatchObject({ outcome: "failed", kind: "automation" });
  });
  it("a missing report with exit 0 is still not a pass", () => {
    expect(classifyPlaywrightReport(null, 0, false)).toMatchObject({ outcome: "failed", kind: "automation" });
  });
  it("an expect that fails only because the element was not found is selector drift (automation)", () => {
    const m = "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button', { name: 'Save' })\nExpected: visible\nReceived: <element(s) not found>";
    expect(classifyPlaywrightReport(report("failed", m), 1, false)).toMatchObject({ kind: "automation" });
    expect(classifyPlaywrightReport(report("failed", "Error: expect(locator).toHaveText(expected) failed\nLocator: locator('h1') resolved to 0 elements"), 1, false)).toMatchObject({ kind: "automation" });
  });
  it("a value mismatch on a found element stays an assertion failure", () => {
    expect(classifyPlaywrightReport(report("failed", "Error: expect(locator).toHaveText(expected) failed\nExpected: Saved\nReceived: Saving"), 1, false)).toMatchObject({ kind: "assertion" });
  });
  it("one failed test among passed ones fails the case", () => {
    const r = { suites: [{ specs: [{ tests: [{ results: [{ status: "passed" }] }, { results: [{ status: "failed", error: { message: "expect(page).toHaveURL(/x/) failed" } }] }] }] }] };
    expect(classifyPlaywrightReport(r, 1, false)).toMatchObject({ kind: "assertion" });
  });
});

describe("expectedSourceKind", () => {
  it("ticket, file, pr and goal refs are authoritative", () => {
    for (const ref of ["linear:DEV-1", "file:/t.md", "pr:https://x/pull/1#description"]) expect(expectedSourceKind(ref, { modules })).toBe("authoritative");
    expect(expectedSourceKind("goal:text", { modules })).toBe("weak"); // the goal is an instruction, not an Expected source (spec §4.14)
  });
  it("a runbook ref is authoritative only for an active module", () => {
    expect(expectedSourceKind("runbook:QA-models/hellyeah/core-journeys.md", { modules })).toBe("weak");
    expect(expectedSourceKind("runbook:QA-models/hellyeah/wallet-payment.md", { modules })).toBe("authoritative");
    expect(expectedSourceKind("runbook:QA-models/hellyeah/unknown.md", { modules })).toBe("weak");
  });
  it("an unknown prefix is weak", () => expect(expectedSourceKind("whatever", { modules })).toBe("weak"));
});

describe("mapVerdict", () => {
  const pass = { outcome: "passed" } as const;
  const assertion = { outcome: "failed", kind: "assertion", message: "m" } as const;
  const auto = { outcome: "failed", kind: "automation", message: "m" } as const;
  it("pass with a recording is Pass", () => expect(mapVerdict({ classification: pass, sourceKind: "weak", generated: false, recordingOk: true }).verdict).toBe("Pass"));
  it("pass without a recording is Automation failure", () => {
    const r = mapVerdict({ classification: pass, sourceKind: "authoritative", generated: false, recordingOk: false });
    expect(r.verdict).toBe("Automation failure");
    expect(r.notes).toMatch(/recording/);
  });
  it("assertion + authoritative + hand-written is ProductFail", () => expect(mapVerdict({ classification: assertion, sourceKind: "authoritative", generated: false, recordingOk: true }).verdict).toBe("ProductFail"));
  it("assertion + weak source is Inconclusive", () => expect(mapVerdict({ classification: assertion, sourceKind: "weak", generated: false, recordingOk: true }).verdict).toBe("Inconclusive"));
  it("assertion from a generated script is always Inconclusive", () => expect(mapVerdict({ classification: assertion, sourceKind: "authoritative", generated: true, recordingOk: true }).verdict).toBe("Inconclusive"));
  it("automation failure stays Automation failure", () => expect(mapVerdict({ classification: auto, sourceKind: "authoritative", generated: false, recordingOk: true }).verdict).toBe("Automation failure"));
  it("a failure without a recording keeps its own verdict but notes the missing recording", () => {
    const r = mapVerdict({ classification: assertion, sourceKind: "authoritative", generated: false, recordingOk: false });
    expect(r.verdict).toBe("Automation failure");
  });
});

describe("summaryExitCode", () => {
  const v = (...verdict: string[]) => verdict.map((x) => ({ verdict: x as never }));
  const none = { notAutomated: 0, skipped: 0 };
  it("ProductFail wins over everything", () => expect(summaryExitCode(v("Pass", "Blocked", "ProductFail"), { notAutomated: 3, skipped: 1 })).toBe(10));
  it("only Pass and NotApplicable is 0", () => expect(summaryExitCode(v("Pass", "NotApplicable"), none)).toBe(0));
  it("Blocked, Inconclusive or Automation failure is 20", () => {
    for (const x of ["Blocked", "Inconclusive", "Automation failure"]) expect(summaryExitCode(v("Pass", x), none)).toBe(20);
  });
  it("not_automated or skipped alone is 20", () => {
    expect(summaryExitCode(v("Pass"), { notAutomated: 1, skipped: 0 })).toBe(20);
    expect(summaryExitCode(v("Pass"), { notAutomated: 0, skipped: 1 })).toBe(20);
  });
});
