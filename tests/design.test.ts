import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDesign } from "../src/commands/design";
import type { CommandContext } from "../src/commands/types";
import { designCases, reviseCases } from "../src/design/design";
import type { LlmRequest, LlmTransport } from "../src/llm/structured";
import { loadRunbook } from "../src/runbook";

const runbook = loadRunbook(path.resolve(__dirname, "../runbook"));
const SRC = { ref: "file:t", title: "T", text: "# T\n\n- Saving shows a banner\n- The banner disappears after 5 seconds\n- Guests cannot save" };
const acceptance = { atoms: [{ id: "A01", text: "banner", sourceRef: "file:t", anchor: "Saving shows a banner" }] };
const GENS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"].map((g) => ({ generator: g, conclusion: g === "G1" ? "produced" : "not_applicable", mechanisms: [], ...(g === "G1" ? {} : { reason: "n/a" }) }));
const draft = (title: string, generator: string, anchor = "Saving shows a banner", sourceRef = "file:t") => ({
  title, generator, type: "happy", expected: { text: "e", sourceRef, anchor }, preconditions: [], risk: "r", testability: { state: "ready" },
});
const out = (cases: unknown[], gens: unknown[] = GENS) => ({ generators: gens, cases, candidatePool: [] });
const t = (payload: unknown) => { const seen: LlmRequest[] = []; const tr: LlmTransport = { async complete(r) { seen.push(r); return JSON.stringify(payload); } }; return { tr, seen }; };
const base = { runbook, acceptance, changeModel: null, sources: [SRC], maxCases: 10, maxRetries: 0 };

describe("designCases", () => {
  it("assigns C01.. ids and returns all seven generator conclusions", async () => {
    const r = await designCases({ ...base, transport: t(out([draft("a", "G1"), draft("b", "G3", "The banner disappears after 5 seconds")])).tr });
    expect(r.cases.map((c) => c.id)).toEqual(["C01", "C02"]);
    expect(r.generators.generators).toHaveLength(7);
  });
  it("rejects output that leaves a generator without a conclusion", async () => {
    const err = await designCases({ ...base, transport: t(out([draft("a", "G1")], GENS.filter((g) => g.generator !== "G5"))).tr }).catch((e) => e);
    expect(err.exitCode).toBe(3);
  });
  it("requires a reason for not_applicable", async () => {
    const bad = GENS.map((g) => (g.generator === "G2" ? { generator: "G2", conclusion: "not_applicable", mechanisms: [] } : g));
    expect((await designCases({ ...base, transport: t(out([draft("a", "G1")], bad)).tr }).catch((e) => e)).exitCode).toBe(3);
  });
  it("moves cases with an unknown source or a paraphrased anchor to the candidate pool", async () => {
    const r = await designCases({ ...base, transport: t(out([draft("ok", "G1"), draft("bad1", "G3", "Saving displays a notice"), draft("bad2", "G3", "Saving shows a banner", "file:other")])).tr });
    expect(r.cases.map((c) => c.title)).toEqual(["ok"]);
    expect(r.generators.candidatePool.map((p) => p.mechanism)).toEqual(["bad1", "bad2"]);
    expect(r.generators.candidatePool[0]!.why).toMatch(/anchor/);
    expect(r.generators.candidatePool[1]!.why).toMatch(/source/);
  });
  it("keeps every G1 case and trims the others over budget, recording each", async () => {
    const drafts = [draft("n1", "G3"), draft("n2", "G3"), draft("n3", "G6"), draft("g1a", "G1"), draft("g1b", "G1")];
    const r = await designCases({ ...base, maxCases: 3, transport: t(out(drafts)).tr });
    expect(r.cases.map((c) => c.title)).toEqual(["n1", "g1a", "g1b"]);
    expect(r.generators.trimmed).toEqual([{ title: "n2", reason: "over budget" }, { title: "n3", reason: "over budget" }]);
  });
  it("never trims below the G1 count even if maxCases is smaller", async () => {
    const r = await designCases({ ...base, maxCases: 1, transport: t(out([draft("g1a", "G1"), draft("g1b", "G1"), draft("n", "G3")])).tr });
    expect(r.cases.map((c) => c.title)).toEqual(["g1a", "g1b"]);
  });
  it("puts the budget, the rules and the verbatim-anchor rule in the prompt", async () => {
    const { tr, seen } = t(out([draft("a", "G1")]));
    await designCases({ ...base, maxCases: 7, transport: tr });
    expect(seen[0]!.system).toContain("七个生成器");
    expect(seen[0]!.system).toMatch(/copied from the source exactly/);
    expect(seen[0]!.system).toContain("7");
  });
});

describe("reviseCases", () => {
  const cases = [
    { id: "C01", ...draft("a", "G1") }, { id: "C02", ...draft("b", "G3", "The banner disappears after 5 seconds") },
  ] as never;
  it("returns only the requested ids, from the model's answer", async () => {
    const revised = { ...(cases as any)[1], title: "b2" };
    const r = await reviseCases({ transport: t({ cases: [revised] }).tr, runbook, cases, feedback: [{ caseId: "C02", reason: "too vague" }], sources: [SRC], acceptance, maxRetries: 0 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "C02", title: "b2" });
  });
  it("is invalid when the model returns a different id set", async () => {
    const wrong = { ...(cases as any)[0], title: "x" };
    const err = await reviseCases({ transport: t({ cases: [wrong] }).tr, runbook, cases, feedback: [{ caseId: "C02", reason: "r" }], sources: [SRC], acceptance, maxRetries: 0 }).catch((e) => e);
    expect(err.exitCode).toBe(3);
  });
});

function ctx(extra: Record<string, string | boolean | undefined> = {}) {
  const runDir = mkdtempSync(path.join(tmpdir(), "qa-dsn-"));
  const w = (n: string, d: unknown) => writeFileSync(path.join(runDir, n), JSON.stringify(d));
  w("acceptance.json", acceptance); w("sources.json", { sources: [SRC] });
  const c: CommandContext = { config: { llm: { maxRetries: 0 }, design: { maxCases: 10 } } as never, runbook, runDir, env: {}, force: false, args: extra };
  return { c, runDir, w, r: (n: string) => JSON.parse(readFileSync(path.join(runDir, n), "utf8")) };
}

describe("runDesign", () => {
  it("writes cases.json, cases.v1.json and generators.json", async () => {
    const x = ctx();
    expect(await runDesign(x.c, { transport: t(out([draft("a", "G1")])).tr })).toBe(0);
    expect(x.r("cases.json")).toEqual(x.r("cases.v1.json"));
    expect(x.r("cases.json").cases[0].id).toBe("C01");
    expect(x.r("generators.json").generators).toHaveLength(7);
  });
  it("exits 2 naming sources.json when it is missing", async () => {
    const x = ctx(); require("node:fs").rmSync(path.join(x.runDir, "sources.json"));
    const errs: string[] = []; const spy = console.error; console.error = (m: string) => errs.push(String(m));
    try { expect(await runDesign(x.c, { transport: t(out([])).tr })).toBe(2); } finally { console.error = spy; }
    expect(errs.join()).toContain("sources.json");
  });
  it("exits 2 when no case is plannable, but still writes generators.json", async () => {
    const x = ctx();
    expect(await runDesign(x.c, { transport: t(out([draft("bad", "G1", "not in source")])).tr })).toBe(2);
    expect(x.r("generators.json").candidatePool).toHaveLength(1);
  });
  it("revise mode changes only the cases marked revise, keeps ids, writes v2 and updates cases.json", async () => {
    const x = ctx();
    await runDesign(x.c, { transport: t(out([draft("a", "G1"), draft("b", "G3", "The banner disappears after 5 seconds")])).tr });
    const before = x.r("cases.json").cases;
    x.w("case-review.json", { entries: [{ caseId: "C01", verdict: "keep", reason: "ok" }, { caseId: "C02", verdict: "revise", reason: "be specific" }] });
    const revised = { ...before[1], title: "b-revised" };
    x.c.args = { revise: true };
    expect(await runDesign(x.c, { transport: t({ cases: [revised] }).tr })).toBe(0);
    const after = x.r("cases.json").cases;
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toMatchObject({ id: "C02", title: "b-revised" });
    expect(readdirSync(x.runDir)).toContain("cases.v2.json");
    expect(x.r("cases.v1.json").cases[1].title).toBe("b");
  });
  it("revise mode with nothing to revise is a no-op returning 0", async () => {
    const x = ctx();
    await runDesign(x.c, { transport: t(out([draft("a", "G1")])).tr });
    x.w("case-review.json", { entries: [{ caseId: "C01", verdict: "keep", reason: "ok" }] });
    x.c.args = { revise: true };
    expect(await runDesign(x.c, { transport: t({ cases: [] }).tr })).toBe(0);
    expect(readdirSync(x.runDir)).not.toContain("cases.v2.json");
  });
});
