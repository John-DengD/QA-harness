import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runExtract, type ExtractDeps } from "../src/commands/extract";
import type { CommandContext } from "../src/commands/types";
import type { LlmTransport } from "../src/llm/structured";
import { loadRunbook } from "../src/runbook";

const REAL = path.resolve(__dirname, "../runbook");
const runbook = loadRunbook(REAL);
const fx = (n: string) => readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const OPENAI = "sk-test-secretvalue-123456";
const TICKET = "# Banner\n\nThe banner disappears after 5 seconds.\n";
const GOOD = { atoms: [{ text: "banner", sourceRef: "", anchor: "The banner disappears after 5 seconds." }], changeModel: { surfaces: ["dashboard"], entities: [], transitions: [], sideEffects: [] } };

function ctx(args: Record<string, string | undefined>, env: Record<string, string> = {}): { c: CommandContext; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-ex-"));
  const runDir = path.join(dir, "run");
  mkdirSync(runDir);
  const c = {
    config: { llm: { maxRetries: 0, model: "m", baseUrl: "https://x.test/v1" } } as CommandContext["config"],
    runbook, runDir, force: false, args,
    env: { OPENAI_API_KEY: OPENAI, E2E_BASE_URL: "https://staging.example.test", ...env },
  } satisfies CommandContext;
  return { c, dir };
}
function ticketFile(dir: string, text = TICKET) { const f = path.join(dir, "ticket.md"); writeFileSync(f, text); return f; }

function transport(payload: (refs: string[]) => unknown): LlmTransport {
  return { async complete(req) { const refs = [...req.user.matchAll(/### SOURCE (\S+)/g)].map((m) => m[1]!); return JSON.stringify(payload(refs)); } };
}
const good = transport((refs) => ({ ...GOOD, atoms: GOOD.atoms.map((a) => ({ ...a, sourceRef: refs[0] })) }));
const noFetch = async () => { throw new Error("no network in this test"); };
const noExec = async () => { throw new Error("no exec in this test"); };
const deps = (t: LlmTransport, over: Partial<ExtractDeps> = {}): ExtractDeps => ({ transport: t, fetch: noFetch as never, exec: noExec as never, ...over });
const files = (d: string) => readdirSync(d).sort();

describe("runExtract", () => {
  it("--ticket-file writes the four artifacts and returns 0", async () => {
    const { c, dir } = ctx({});
    c.args = { ticketFile: ticketFile(dir) };
    expect(await runExtract(c, deps(good))).toBe(0);
    expect(files(c.runDir)).toEqual(["acceptance.json", "change-model.json", "env.json", "extract-report.json", "sources.json"]);
    expect(JSON.parse(readFileSync(path.join(c.runDir, "sources.json"), "utf8")).sources[0].text).toContain("The banner disappears after 5 seconds.");
    expect(JSON.parse(readFileSync(path.join(c.runDir, "acceptance.json"), "utf8")).atoms[0].id).toBe("A01");
    expect(JSON.parse(readFileSync(path.join(c.runDir, "env.json"), "utf8"))).toMatchObject({ kind: "staging", baseUrl: "https://staging.example.test" });
  });

  it("returns 2 and writes only the report when no atom survives", async () => {
    const { c, dir } = ctx({});
    c.args = { ticketFile: ticketFile(dir) };
    const bad = transport((refs) => ({ ...GOOD, atoms: [{ text: "x", sourceRef: refs[0], anchor: "not in the ticket" }] }));
    expect(await runExtract(c, deps(bad))).toBe(2);
    expect(files(c.runDir)).toEqual(["extract-report.json", "sources.json"]);
  });

  it("works with LINEAR_API_KEY unset for --ticket-file, and names it for --ticket", async () => {
    const a = ctx({}); a.c.args = { ticketFile: ticketFile(a.dir) };
    expect(await runExtract(a.c, deps(good))).toBe(0);
    const b = ctx({}); b.c.args = { ticket: "DEV-1" };
    const errs: string[] = []; const spy = console.error; console.error = (m: string) => errs.push(String(m));
    try { expect(await runExtract(b.c, deps(good))).toBe(2); } finally { console.error = spy; }
    expect(errs.join("\n")).toContain("LINEAR_API_KEY");
  });

  it("--ticket: a linked open PR with a live sandbox sets a pr-sandbox env", async () => {
    const { c } = ctx({}, { LINEAR_API_KEY: "lin_api_secretvalue123456" });
    c.args = { ticket: "DEV-1" };
    const HEAD = "3a5a2ab" + "d".repeat(33);
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { issue: { identifier: "DEV-1", title: "Banner", description: "The banner disappears after 5 seconds. PR https://github.com/acme/app/pull/9", comments: { nodes: [] } } } }) });
    const exec = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ number: 9, state: "OPEN", headRefOid: HEAD, baseRefOid: "b".repeat(40), body: "d", url: "https://github.com/acme/app/pull/9", comments: [{ author: { login: "github-actions" }, body: fx("sandbox-comment-ready.md"), url: "u" }] }) });
    expect(await runExtract(c, deps(good, { fetch, exec }))).toBe(0);
    expect(JSON.parse(readFileSync(path.join(c.runDir, "env.json"), "utf8"))).toMatchObject({ kind: "pr-sandbox", prNumber: 9, baseUrl: "https://dashboard-fixture.example.test" });
  });

  it("--pr with a merged PR returns 2 and writes no env.json", async () => {
    const { c } = ctx({});
    c.args = { pr: "https://github.com/acme/app/pull/9" };
    const exec = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ number: 9, state: "MERGED", headRefOid: "a".repeat(40), baseRefOid: "b".repeat(40), body: "The banner disappears after 5 seconds.", url: "https://github.com/acme/app/pull/9", comments: [] }) });
    expect(await runExtract(c, deps(good, { exec }))).toBe(2);
    expect(existsSync(path.join(c.runDir, "env.json"))).toBe(false);
  });

  it("returns 3 when the LLM keeps failing", async () => {
    const { c, dir } = ctx({});
    c.args = { ticketFile: ticketFile(dir) };
    const broken: LlmTransport = { async complete() { throw new Error("503"); } };
    expect(await runExtract(c, deps(broken))).toBe(3);
  });

  it("requires exactly one input", async () => {
    const none = ctx({}); expect(await runExtract(none.c, deps(good))).toBe(2);
    const two = ctx({}); two.c.args = { ticketFile: ticketFile(two.dir), pr: "https://github.com/a/b/pull/1" };
    expect(await runExtract(two.c, deps(good))).toBe(2);
  });

  it("--goal uses the goal text and core-journeys as sources, env from E2E_BASE_URL", async () => {
    const { c } = ctx({});
    c.args = { goal: "regress the main flow" };
    let refs: string[] = [];
    const t = transport((r) => { refs = r; return { atoms: [], changeModel: GOOD.changeModel }; });
    await runExtract(c, deps(t));
    expect(refs).toEqual(["goal:text", "runbook:QA-models/hellyeah/core-journeys.md"]);
    expect(JSON.parse(readFileSync(path.join(c.runDir, "extract-report.json"), "utf8")).sources).toHaveLength(2);
  });

  it("fails with exit 2 naming E2E_BASE_URL when a staging mode has no address", async () => {
    const { c, dir } = ctx({});
    c.args = { ticketFile: ticketFile(dir) };
    delete (c.env as Record<string, string | undefined>).E2E_BASE_URL;
    expect(await runExtract(c, deps(good))).toBe(2);
    expect(files(c.runDir)).toEqual([]);
  });

  it("never writes a secret value into the run directory", async () => {
    const { c, dir } = ctx({});
    c.args = { ticketFile: ticketFile(dir) };
    await runExtract(c, deps(good));
    for (const f of files(c.runDir)) expect(readFileSync(path.join(c.runDir, f), "utf8")).not.toContain(OPENAI);
  });
});
