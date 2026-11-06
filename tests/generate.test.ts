import type { LlmRequest, LlmTransport } from "../src/llm/structured";
import { generateScript } from "../src/run/generate";

const kase = { id: "C01", title: "Banner after save", generator: "G1", type: "happy", expected: { text: "A banner appears after saving", sourceRef: "s", anchor: "Saving shows a banner" }, preconditions: ["signed in"], risk: "r", testability: { state: "ready" } } as never;
const OK_CODE = `import { test, expect } from "./fixtures";\ntest("x", async ({ page }) => { await expect(page).toHaveURL(/x/); });`;
const t = (code = OK_CODE, sideEffects: string[] = []) => {
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
    expect(seen[0]!.system).toContain("./fixtures");
  });
});

describe("static gate on generated code", () => {
  const run = async (code: string) => {
    const { tr, seen } = t(code);
    let validated = 0;
    const r = await generateScript({ ...base, maxRetries: 0, transport: tr, domSnapshot: "d", validate: async () => { validated++; return { ok: true, output: "" }; } });
    return { r, seen, validated };
  };
  it("rejects code that imports @playwright/test directly (it would bypass the sandbox browser)", async () => {
    const x = await run(`import { test, expect } from "@playwright/test";\ntest("x", async ({ page }) => { await expect(page).toHaveURL(/x/); });`);
    expect(x.r).toMatchObject({ ok: false });
    expect((x.r as { reason: string }).reason).toMatch(/fixtures/);
    expect(x.validated).toBe(0);
  });
  it("rejects code with no assertion, with zero or several tests, or with skip/fixme/only", async () => {
    for (const code of [
      `import { test } from "./fixtures";\ntest("x", async ({ page }) => { await page.goto("/"); });`,
      `import { test, expect } from "./fixtures";\nexpect(1).toBe(1);`,
      `import { test, expect } from "./fixtures";\ntest("a", async () => { expect(1).toBe(1); });\ntest("b", async () => { expect(1).toBe(1); });`,
      `import { test, expect } from "./fixtures";\ntest.skip("a", async () => { expect(1).toBe(1); });`,
    ]) {
      const x = await run(code);
      expect(x.r, code).toMatchObject({ ok: false });
      expect(x.validated, code).toBe(0);
    }
  });
  it("feeds the gate message back to the model like a type error", async () => {
    const { tr, seen } = t(`import { test } from "./fixtures";\ntest("x", async () => {});`);
    await generateScript({ ...base, maxRetries: 1, transport: tr, domSnapshot: "d", validate: async () => ({ ok: true, output: "" }) });
    expect(seen).toHaveLength(2);
    expect(seen[1]!.user).toMatch(/expect\(/);
  });
});
