import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDesign } from "../src/commands/design";
import { runExtract } from "../src/commands/extract";
import { runReport } from "../src/commands/report";
import { runReviewLoop } from "../src/commands/review-loop";
import { runRun } from "../src/commands/run";
import type { CommandContext } from "../src/commands/types";
import type { LlmRequest, LlmTransport } from "../src/llm/structured";
import type { RunDeps } from "../src/run/types";
import { loadRunbook } from "../src/runbook";

const TICKET = "# Banner\n\n- Saving shows a banner\n- The banner disappears after 5 seconds\n- Guests cannot save\n";
const SECRET = "sk-openai-secret-value-123456";
const PASS = { suites: [{ specs: [{ tests: [{ results: [{ status: "passed" }] }] }] }] };
const FAIL = { suites: [{ specs: [{ tests: [{ results: [{ status: "failed", error: { message: "expect(locator).toHaveText(x) failed" } }] }] }] }] };

const GENS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"].map((g) => ({ generator: g, conclusion: g === "G1" ? "produced" : "not_applicable", mechanisms: [], ...(g === "G1" ? {} : { reason: "n/a" }) }));
const draft = (title: string, anchor: string) => ({ title, generator: "G1", type: "happy", expected: { text: `expect: ${anchor}`, sourceRef: "", anchor }, preconditions: ["signed in"], risk: "r", testability: { state: "ready" } });

function transport(sourceRef: () => string): { t: LlmTransport; seen: string[] } {
  const seen: string[] = [];
  const t: LlmTransport = {
    async complete(req: LlmRequest) {
      seen.push(req.schemaName);
      switch (req.schemaName) {
        case "extract_atoms":
          return JSON.stringify({
            atoms: [{ text: "banner", sourceRef: sourceRef(), anchor: "Saving shows a banner" }, { text: "toast", sourceRef: sourceRef(), anchor: "The banner disappears after 5 seconds" }, { text: "guest", sourceRef: sourceRef(), anchor: "Guests cannot save" }],
            changeModel: { surfaces: ["dashboard"], entities: ["banner"], transitions: [], sideEffects: [] },
          });
        case "design_cases": {
          const ref = sourceRef();
          const mk = (title: string, anchor: string) => { const d = draft(title, anchor); d.expected.sourceRef = ref; return d; };
          return JSON.stringify({ generators: GENS, cases: [mk("Banner shows", "Saving shows a banner"), mk("Banner hides", "The banner disappears after 5 seconds"), mk("Guest blocked", "Guests cannot save")], candidatePool: [] });
        }
        case "review_cases": {
          const ids = [...req.user.matchAll(/"id": "(C\d+)"/g)].map((m) => m[1]!);
          return JSON.stringify({ entries: ids.map((caseId) => ({ caseId, verdict: "keep", reason: "in scope and distinct" })) });
        }
        case "generate_playwright_spec":
          return JSON.stringify({ code: "import { test, expect } from './fixtures'; test('x', async ({ page }) => {});", sideEffects: [] });
        default:
          throw new Error(`unexpected LLM call ${req.schemaName}`);
      }
    },
  };
  return { t, seen };
}

describe("pipeline dry run (no network)", () => {
  it("extract -> design -> review -> run -> report hand over artifacts and end with the right exit code", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-pipe-"));
    const runDir = path.join(root, "DEMO", "runs", "r1");
    mkdirSync(runDir, { recursive: true });
    const ticketFile = path.join(root, "ticket.md");
    writeFileSync(ticketFile, TICKET);

    const rb = loadRunbook(path.resolve(__dirname, "../runbook"));
    const runbook = { ...rb, text: (f: string) => (f === "script-bindings.json" ? JSON.stringify({ bindings: [{ title: "Banner shows", spec: "tests/release/cases/pass.spec.ts" }, { title: "Banner hides", spec: "tests/release/cases/fail.spec.ts" }] }) : rb.text(f)) };
    const ctx: CommandContext = {
      config: { llm: { maxRetries: 0, model: "m", baseUrl: "https://x" }, design: { maxCases: 10 }, run: { caseTimeoutMs: 1000, totalTimeoutMs: 100000 } } as never,
      runbook, runDir, force: false, args: { ticketFile },
      env: { OPENAI_API_KEY: SECRET, E2B_API_KEY: "e2b-secret-value-123456", E2E_BASE_URL: "https://staging.example.test" },
    };
    const { t, seen } = transport(() => `file:${ticketFile}`);
    const unreachable = async () => { throw new Error("no network in this test"); };

    expect(await runExtract(ctx, { transport: t, fetch: unreachable as never, exec: unreachable as never })).toBe(0);
    expect(readdirSync(runDir)).toEqual(expect.arrayContaining(["acceptance.json", "change-model.json", "env.json", "extract-report.json", "sources.json"]));

    ctx.args = {};
    expect(await runDesign(ctx, { transport: t })).toBe(0);
    expect(JSON.parse(readFileSync(path.join(runDir, "cases.json"), "utf8")).cases.map((c: { id: string }) => c.id)).toEqual(["C01", "C02", "C03"]);

    expect(await runReviewLoop(ctx, { transport: t })).toBe(0);
    expect(JSON.parse(readFileSync(path.join(runDir, "cases.reviewed.json"), "utf8")).cases).toHaveLength(3);

    const runDeps: RunDeps = {
      sandbox: { async create() { return { sandboxId: "sb1" }; }, async startRecording() {}, async stopRecording() { return { videoPath: "v.mp4", bytes: 99 }; }, async snapshot() { return "- button 'Save'"; }, async kill() {} },
      playwright: { async run(o) { const fail = o.specPath.includes("fail.spec") || o.specPath.includes("generated-specs"); return { exitCode: fail ? 1 : 0, stdout: `ran ${o.specPath} with ${SECRET}`, stderr: "", reportJson: fail ? FAIL : PASS, timedOut: false }; } },
      registry: { async register() {} },
      validate: async () => ({ ok: true, output: "" }),
    };
    expect(await runRun(ctx, { runDeps, transport: t })).toBe(10);
    const verdicts = Object.fromEntries(["C01", "C02", "C03"].map((id) => [id, JSON.parse(readFileSync(path.join(runDir, "results", `${id}.json`), "utf8"))]));
    expect(verdicts.C01.verdict).toBe("Pass");
    expect(verdicts.C02.verdict).toBe("ProductFail");
    expect(verdicts.C03).toMatchObject({ verdict: "Inconclusive", generated: true });
    expect(existsSync(path.join(runDir, "generated-specs", "C03.spec.ts"))).toBe(true);

    expect(await runReport(ctx)).toBe(10);
    const report = readFileSync(path.join(runDir, "report.md"), "utf8");
    expect(report).toContain("Banner hides");
    expect(report).toContain("执行后的结论没有经过独立复核");

    // the LLM was used only for the thinking stages and script generation
    expect(new Set(seen)).toEqual(new Set(["extract_atoms", "design_cases", "review_cases", "generate_playwright_spec"]));
    // no secret value reached any artifact
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(runDir)) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toContain(SECRET);
      expect(text, f).not.toContain("e2b-secret-value-123456");
    }
  });
});
