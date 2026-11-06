import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReviewLoop } from "../src/commands/review-loop";
import type { CommandContext } from "../src/commands/types";
import type { LlmRequest, LlmTransport } from "../src/llm/structured";
import { loadRunbook } from "../src/runbook";

const runbook = loadRunbook(path.resolve(__dirname, "../runbook"));
const SRC = { ref: "file:t", title: "T", text: "- Saving shows a banner\n- The banner disappears after 5 seconds" };
const mk = (id: string, anchor: string, title = `case ${id}`) => ({ id, title, generator: "G1", type: "happy", expected: { text: "e", sourceRef: "file:t", anchor }, preconditions: [], risk: "r", testability: { state: "ready" } });
const cases = [mk("C01", "Saving shows a banner"), mk("C02", "The banner disappears after 5 seconds")];

function setup(reviewerVerdicts: ((round: number) => string)) {
  const runDir = mkdtempSync(path.join(tmpdir(), "qa-loop-"));
  const w = (n: string, d: unknown) => writeFileSync(path.join(runDir, n), JSON.stringify(d));
  w("acceptance.json", { atoms: [] }); w("sources.json", { sources: [SRC] }); w("cases.json", { cases }); w("cases.v1.json", { cases }); // as written by qa design
  const calls: string[] = [];
  let reviews = 0;
  const transport: LlmTransport = {
    async complete(req: LlmRequest) {
      calls.push(req.schemaName);
      if (req.schemaName === "review_cases") {
        reviews++;
        const c2 = reviewerVerdicts(reviews);
        return JSON.stringify({ entries: [{ caseId: "C01", verdict: "keep", reason: "ok" }, { caseId: "C02", verdict: c2, reason: "r" + reviews }] });
      }
      return JSON.stringify({ cases: [mk("C02", "The banner disappears after 5 seconds", "revised")] });
    },
  };
  const c: CommandContext = { config: { llm: { maxRetries: 0 } } as never, runbook, runDir, env: {}, force: false, args: {} };
  return { c, runDir, calls, transport, r: (n: string) => JSON.parse(readFileSync(path.join(runDir, n), "utf8")) };
}

const count = (calls: string[], name: string) => calls.filter((n) => n === name).length;

describe("runReviewLoop", () => {
  it("does not call design when nothing is marked revise", async () => {
    const x = setup(() => "keep");
    expect(await runReviewLoop(x.c, { transport: x.transport })).toBe(0);
    expect(x.calls).toEqual(["review_cases"]);
    expect(x.r("cases.reviewed.json").cases).toHaveLength(2);
  });

  it("revises once and ends when the second review keeps everything", async () => {
    const x = setup((round) => (round === 1 ? "revise" : "keep"));
    expect(await runReviewLoop(x.c, { transport: x.transport })).toBe(0);
    expect(x.calls).toEqual(["review_cases", "revise_cases", "review_cases"]);
    expect(readdirSync(x.runDir)).toEqual(expect.arrayContaining(["cases.v2.json", "case-review.v2.json"]));
    expect(x.r("cases.reviewed.json").cases.map((c: { title: string }) => c.title)).toEqual(["case C01", "revised"]);
  });

  it("stops after two revisions; the third review turns a still-revise case into drop", async () => {
    const x = setup(() => "revise");
    expect(await runReviewLoop(x.c, { transport: x.transport })).toBe(0);
    expect(count(x.calls, "revise_cases")).toBe(2);
    expect(count(x.calls, "review_cases")).toBe(3);
    const last = x.r("case-review.json").entries.find((e: { caseId: string }) => e.caseId === "C02");
    expect(last.verdict).toBe("drop");
    expect(last.reason).toContain("revise limit reached");
    expect(x.r("cases.reviewed.json").cases.map((c: { id: string }) => c.id)).toEqual(["C01"]);
  });

  it("returns a failing review's exit code immediately", async () => {
    const x = setup(() => "keep");
    const broken: LlmTransport = { async complete() { throw new Error("503"); } };
    expect(await runReviewLoop(x.c, { transport: broken })).toBe(3);
  });
});
