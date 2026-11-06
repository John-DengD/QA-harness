import type { LlmRequest, LlmTransport } from "../src/llm/structured";
import { generateScript } from "../src/run/generate";

const kase = { id: "C01", title: "Banner after save", generator: "G1", type: "happy", expected: { text: "A banner appears after saving", sourceRef: "s", anchor: "Saving shows a banner" }, preconditions: ["signed in"], risk: "r", testability: { state: "ready" } } as never;
const t = (code = "import {test} from '@playwright/test'; test('x', async () => {});", sideEffects: string[] = []) => {
  const seen: LlmRequest[] = [];
  const tr: LlmTransport = { async complete(r) { seen.push(r); return JSON.stringify({ code, sideEffects }); } };
  return { tr, seen };
};
const base = { case: kase, baseUrl: "https://app.example.test", maxRetries: 1, writeSpec: async () => "/tmp/gen/C01.spec.ts" };

describe("generateScript", () => {
  it("returns the spec path, declared side effects and code when validation passes", async () => {
    const { tr } = t(undefined, ["campaign-draft"]);
    const r = await generateScript({ ...base, transport: tr, domSnapshot: "<html/>", validate: async () => ({ ok: true, output: "" }) });
    expect(r).toMatchObject({ ok: true, specPath: "/tmp/gen/C01.spec.ts", sideEffects: ["campaign-draft"] });
  });
  it("feeds the validator output of a failed attempt into the next attempt", async () => {
    const { tr, seen } = t();
    let n = 0;
    const r = await generateScript({ ...base, transport: tr, domSnapshot: "d", validate: async () => (++n === 1 ? { ok: false, output: "TS2304: Cannot find name foo" } : { ok: true, output: "" }) });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.user).toContain("TS2304: Cannot find name foo");
  });
  it("gives up after maxRetries + 1 attempts with the last validator output in the reason", async () => {
    const { tr, seen } = t();
    const r = await generateScript({ ...base, transport: tr, domSnapshot: "d", validate: async () => ({ ok: false, output: "boom ".repeat(400) }) });
    expect(seen).toHaveLength(2);
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toContain("boom");
    expect((r as { reason: string }).reason.length).toBeLessThan(900);
  });
  it("an LLM failure is a failed generation, not an exception", async () => {
    const tr: LlmTransport = { async complete() { throw new Error("503"); } };
    const r = await generateScript({ ...base, maxRetries: 0, transport: tr, domSnapshot: "d", validate: async () => ({ ok: true, output: "" }) });
    expect(r).toMatchObject({ ok: false });
  });
  it("puts the case's expected text and base URL in the prompt and clips the DOM to 60000 characters", async () => {
    const { tr, seen } = t();
    await generateScript({ ...base, transport: tr, domSnapshot: "x".repeat(100000), validate: async () => ({ ok: true, output: "" }) });
    expect(seen[0]!.user).toContain("A banner appears after saving");
    expect(seen[0]!.user).toContain("https://app.example.test");
    expect(seen[0]!.user.length).toBeLessThan(70000);
    expect(seen[0]!.system).toMatch(/sideEffects/);
  });
});
