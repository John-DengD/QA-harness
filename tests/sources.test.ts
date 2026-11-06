import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigError } from "../src/config";
import { ExternalError } from "../src/errors";
import { fetchLinearIssue } from "../src/sources/linear";
import { fetchPr } from "../src/sources/github";
import { loadTicketFile } from "../src/sources/ticket-file";
import type { ExecLike, FetchLike } from "../src/sources/types";

describe("loadTicketFile", () => {
  it("returns the text with a file: ref", () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "qa-src-")), "t.md");
    writeFileSync(f, "# Title line\n\nBody text\n");
    const doc = loadTicketFile(f);
    expect(doc.ref).toBe(`file:${f}`);
    expect(doc.text).toContain("Body text");
    expect(doc.title).toBe("Title line");
  });
  it("names the path when the file is missing or empty", () => {
    expect(() => loadTicketFile("/nonexistent/t.md")).toThrow(/nonexistent\/t\.md/);
    const f = path.join(mkdtempSync(path.join(tmpdir(), "qa-src-")), "empty.md");
    writeFileSync(f, "  \n");
    expect(() => loadTicketFile(f)).toThrow(ConfigError);
  });
});

const KEY = "lin_api_secretvalue123456";
function fakeFetch(res: { ok: boolean; status: number; body: unknown }) {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f: FetchLike = async (url, init) => {
    seen.push({ url, headers: init.headers, body: init.body });
    return { ok: res.ok, status: res.status, json: async () => res.body };
  };
  return { f, seen };
}

describe("fetchLinearIssue", () => {
  const issue = { identifier: "DEV-1", title: "Add banner", description: "Show a banner.", comments: { nodes: [{ body: "Also on mobile" }] } };
  it("sends the key and joins title, description and comments", async () => {
    const { f, seen } = fakeFetch({ ok: true, status: 200, body: { data: { issue } } });
    const doc = await fetchLinearIssue({ id: "DEV-1", apiKey: KEY, fetch: f });
    expect(seen[0]!.headers.Authorization).toBe(KEY);
    expect(doc.ref).toBe("linear:DEV-1");
    expect(doc.text).toContain("Show a banner.");
    expect(doc.text).toContain("Also on mobile");
    expect(doc.title).toBe("Add banner");
  });
  it("throws ExternalError without leaking the key on 401 and on GraphQL errors", async () => {
    for (const body of [{ errors: [{ message: `bad ${KEY}` }] }, {}]) {
      for (const status of [401, 200]) {
        const { f } = fakeFetch({ ok: status === 200, status, body });
        const err = await fetchLinearIssue({ id: "DEV-1", apiKey: KEY, fetch: f }).catch((e) => e);
        expect(err).toBeInstanceOf(ExternalError);
        expect(err.message).not.toContain(KEY);
      }
    }
  });
});

describe("fetchPr", () => {
  const url = "https://github.com/acme/app/pull/12";
  const payload = {
    number: 12, state: "MERGED", headRefOid: "a".repeat(40), baseRefOid: "b".repeat(40), body: "desc", url,
    comments: [{ author: { login: "github-actions" }, body: "hello", url: url + "#c1" }],
  };
  it("parses gh output into PrInfo", async () => {
    const calls: string[][] = [];
    const exec: ExecLike = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: JSON.stringify(payload), stderr: "" }; };
    const pr = await fetchPr({ url, exec });
    expect(calls[0]!.slice(0, 3)).toEqual(["gh", "pr", "view"]);
    expect(pr).toMatchObject({ number: 12, repo: "acme/app", state: "MERGED", headSha: "a".repeat(40), baseSha: "b".repeat(40), description: "desc" });
    expect(pr.comments[0]).toEqual({ author: "github-actions", body: "hello", url: url + "#c1" });
  });
  it("throws ExternalError naming the PR when gh fails", async () => {
    const exec: ExecLike = async () => ({ code: 1, stdout: "", stderr: "not found" });
    const err = await fetchPr({ url, exec }).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalError);
    expect(err.message).toContain(url);
  });
});
