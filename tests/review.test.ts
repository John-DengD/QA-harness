import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReview } from "../src/commands/review";
import type { CommandContext } from "../src/commands/types";
import type { LlmRequest, LlmTransport } from "../src/llm/structured";
import { reviewCases } from "../src/review/review";
import { loadRunbook } from "../src/runbook";

const runbook = loadRunbook(path.resolve(__dirname, "../runbook"));
const SRC = { ref: "file:t", title: "T", text: "- Saving shows a banner\n- The banner disappears after 5 seconds\n- Guests cannot save" };
const acceptance = { atoms: [{ id: "A01", text: "banner", sourceRef: "file:t", anchor: "Saving shows a banner" }] };
const mk = (id: string, anchor: string) => ({ id, title: `case ${id}`, generator: "G1", type: "happy", expected: { text: "e", sourceRef: "file:t", anchor }, preconditions: [], risk: "r", testability: { state: "ready" } });
const cases = [mk("C01", "Saving shows a banner"), mk("C02", "The banner disappears after 5 seconds"), mk("C03", "Guests cannot save")] as never;
const t = (payload: unknown) => { const seen: LlmRequest[] = []; const tr: LlmTransport = { async complete(r) { seen.push(r); return JSON.stringify(payload); } }; return { tr, seen }; };
const entry = (caseId: string, verdict: string, reason = "because") => ({ caseId, verdict, reason });
const base = { runbook, cases, acceptance, sources: [SRC], maxRetries: 0, round: 1, maxRevisions: 2 };

describe("reviewCases", () => {
  it("returns entries with reasons and only the kept cases", async () => {
    const r = await reviewCases({ ...base, transport: t({ entries: [entry("C01", "keep"), entry("C02", "drop", "duplicate of C01"), entry("C03", "revise", "too vague")] }).tr });
    expect(r.entries.map((e) => e.verdict)).toEqual(["keep", "drop", "revise"]);
    expect(r.reviewed.map((c) => c.id)).toEqual(["C01"]);
  });
  it("drops an un-anchored case in code and never sends it to the model", async () => {
    const bad = [mk("C01", "Saving shows a banner"), mk("C02", "this sentence is not in the source")] as never;
    const { tr, seen } = t({ entries: [entry("C01", "keep")] });
    const r = await reviewCases({ ...base, cases: bad, transport: tr });
    expect(r.entries.find((e) => e.caseId === "C02")).toMatchObject({ verdict: "drop", reason: expect.stringContaining("anchor not found in source") });
    expect(seen[0]!.user).not.toContain("this sentence is not in the source");
    expect(r.reviewed.map((c) => c.id)).toEqual(["C01"]);
  });
  it("is invalid when the model omits an id, adds an unknown one, or repeats one", async () => {
    for (const entries of [[entry("C01", "keep"), entry("C02", "keep")], [entry("C01", "keep"), entry("C02", "keep"), entry("C03", "keep"), entry("C99", "keep")], [entry("C01", "keep"), entry("C01", "keep"), entry("C02", "keep")]]) {
      expect((await reviewCases({ ...base, transport: t({ entries }).tr }).catch((e) => e)).exitCode).toBe(3);
    }
  });
  it("is invalid when a reason is empty", async () => {
    expect((await reviewCases({ ...base, transport: t({ entries: [entry("C01", "keep", ""), entry("C02", "keep"), entry("C03", "keep")] }).tr }).catch((e) => e)).exitCode).toBe(3);
  });
  it("turns revise into drop once the revision limit is exceeded", async () => {
    const r = await reviewCases({ ...base, round: 3, transport: t({ entries: [entry("C01", "keep"), entry("C02", "revise", "still vague"), entry("C03", "keep")] }).tr });
    expect(r.entries.find((e) => e.caseId === "C02")).toMatchObject({ verdict: "drop", reason: expect.stringContaining("revise limit reached") });
    expect(r.entries.find((e) => e.caseId === "C02")!.reason).toContain("still vague");
  });
  it("sends only the cases, acceptance, sources and runbook rules: no design-stage material", async () => {
    const { tr, seen } = t({ entries: [entry("C01", "keep"), entry("C02", "keep"), entry("C03", "keep")] });
    await reviewCases({ ...base, transport: tr });
    const all = seen[0]!.system + seen[0]!.user;
    expect(all).not.toMatch(/candidatePool|trimmed|generators\.json/);
    expect(seen[0]!.system).toMatch(/duplicate/i);
    expect(seen[0]!.user).toContain("Saving shows a banner");
  });
});

function ctx() {
  const runDir = mkdtempSync(path.join(tmpdir(), "qa-rev-"));
  const w = (n: string, d: unknown) => writeFileSync(path.join(runDir, n), JSON.stringify(d));
  w("acceptance.json", acceptance); w("sources.json", { sources: [SRC] }); w("cases.json", { cases });
  const c: CommandContext = { config: { llm: { maxRetries: 0 } } as never, runbook, runDir, env: {}, force: false, args: {} };
  return { c, runDir, r: (n: string) => JSON.parse(readFileSync(path.join(runDir, n), "utf8")) };
}

describe("runReview", () => {
  it("writes case-review.json, case-review.v1.json and cases.reviewed.json with the kept cases only", async () => {
    const x = ctx();
    expect(await runReview(x.c, { transport: t({ entries: [entry("C01", "keep"), entry("C02", "drop", "dup"), entry("C03", "keep")] }).tr })).toBe(0);
    expect(x.r("case-review.json")).toEqual(x.r("case-review.v1.json"));
    expect(x.r("cases.reviewed.json").cases.map((c: { id: string }) => c.id)).toEqual(["C01", "C03"]);
    expect(x.r("case-review.json").entries.find((e: { caseId: string }) => e.caseId === "C02").reason).toBe("dup");
  });
  it("a second review is round 2 and writes v2", async () => {
    const x = ctx();
    const ok = t({ entries: [entry("C01", "keep"), entry("C02", "keep"), entry("C03", "keep")] });
    await runReview(x.c, { transport: ok.tr });
    await runReview(x.c, { transport: ok.tr });
    expect(readdirSync(x.runDir)).toEqual(expect.arrayContaining(["case-review.v1.json", "case-review.v2.json"]));
  });
  it("exits 2 naming cases.json when it is missing", async () => {
    const x = ctx(); require("node:fs").rmSync(path.join(x.runDir, "cases.json"));
    const errs: string[] = []; const spy = console.error; console.error = (m: string) => errs.push(String(m));
    try { expect(await runReview(x.c, { transport: t({}).tr })).toBe(2); } finally { console.error = spy; }
    expect(errs.join()).toContain("cases.json");
  });
});
