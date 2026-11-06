import { z } from "zod";
import type { Case } from "../contracts/cases";
import { callStructured, type LlmTransport } from "../llm/structured";

export type ScriptValidator = (specPath: string) => Promise<{ ok: boolean; output: string }>;

const Out = z.object({ code: z.string().min(1), sideEffects: z.array(z.string()) });
const DOM_LIMIT = 60_000;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

const SYSTEM = [
  "You write ONE Playwright test (TypeScript) that checks a single test case against the live page described by the DOM snapshot.",
  "Rules:",
  "- Import `test` and `expect` from `@playwright/test`, or from the project fixtures the existing specs use (`../../src/fixtures`) when you need the CDP-connected browser. Use one `test(...)`.",
  "- Use role/text/label locators taken from the DOM snapshot; never invent selectors that are not in it. No hard-coded waits longer than needed; prefer web-first assertions.",
  "- The assertions must check the case's Expected text. Do not weaken them to make the test pass.",
  "- Navigate from the given base URL. Never put credentials in the code; read them from `process.env` if the case needs a login.",
  "- Declare every side effect the script performs in `sideEffects` (e.g. `campaign-draft`, `disposable-account`, `submit-payment`, `launch`). Use an empty list for read-only scripts. Do not perform a side effect you did not declare.",
  "- Do not retry a side-effecting action blindly; after a timeout, only read state.",
  "Return JSON: { code, sideEffects }.",
].join("\n");

function userPrompt(c: Case, baseUrl: string, dom: string, lastFailure: string | null): string {
  return [
    `## Case ${c.id}: ${c.title}`,
    `Type: ${c.type}`,
    `Preconditions: ${JSON.stringify(c.preconditions)}`,
    `Expected: ${c.expected.text}`,
    `Source anchor: ${c.expected.anchor}`,
    `## Base URL\n${baseUrl}`,
    `## DOM snapshot (clipped)\n${clip(dom, DOM_LIMIT)}`,
    ...(lastFailure ? [`## The previous attempt failed validation; fix it:\n${clip(lastFailure, 4000)}`] : []),
  ].join("\n\n");
}

export async function generateScript(opts: {
  transport: LlmTransport;
  case: Case;
  domSnapshot: string;
  baseUrl: string;
  validate: ScriptValidator;
  writeSpec: (code: string) => Promise<string>;
  maxRetries: number;
}): Promise<{ ok: true; specPath: string; sideEffects: string[]; code: string } | { ok: false; reason: string }> {
  let lastFailure: string | null = null;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    let out: z.infer<typeof Out>;
    try {
      out = await callStructured({
        transport: opts.transport,
        schema: Out,
        schemaName: "generate_playwright_spec",
        system: SYSTEM,
        user: userPrompt(opts.case, opts.baseUrl, opts.domSnapshot, lastFailure),
        maxRetries: 0,
      });
    } catch (e) {
      lastFailure = (e as Error).message;
      continue;
    }
    const specPath = await opts.writeSpec(out.code);
    const v = await opts.validate(specPath);
    if (v.ok) return { ok: true, specPath, sideEffects: out.sideEffects, code: out.code };
    lastFailure = v.output;
  }
  return { ok: false, reason: `generation failed after ${opts.maxRetries + 1} attempt(s): ${clip(lastFailure ?? "no attempt made", 600)}` };
}
