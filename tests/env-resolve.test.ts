import { readFileSync } from "node:fs";
import path from "node:path";
import { EnvError, parseSandboxComment, resolvePrEnv, selectCandidates, shaMatches, stagingEnv } from "../src/env-resolve";
import type { Environments } from "../src/environments";
import type { PrInfo } from "../src/sources/types";

const fx = (n: string) => readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const rules: Environments["prSandbox"] = JSON.parse(readFileSync(path.join(__dirname, "../runbook/environments.json"), "utf8")).prSandbox;
const HEAD = "3a5a2ab" + "c".repeat(33);

function pr(over: Partial<PrInfo> = {}): PrInfo {
  return { url: "https://github.com/acme/app/pull/9", number: 9, repo: "acme/app", state: "OPEN", headSha: HEAD, baseSha: "b".repeat(40), description: "d", comments: [], ...over };
}
const comment = (body: string, author = "github-actions") => ({ author, body, url: "https://github.com/acme/app/pull/9#c" });

describe("selectCandidates", () => {
  it("excludes merged and closed PRs with a reason naming the PR", () => {
    const r = selectCandidates([pr(), pr({ number: 8, url: "u8", state: "MERGED" }), pr({ number: 7, url: "u7", state: "CLOSED" })]);
    expect(r.open.map((p) => p.number)).toEqual([9]);
    expect(r.excluded.map((e) => e.pr.number)).toEqual([8, 7]);
    expect(r.excluded[0]!.reason).toContain("u8");
  });
});

describe("parseSandboxComment", () => {
  it("reads status, urls and footer SHA from the ready comment", () => {
    expect(parseSandboxComment(fx("sandbox-comment-ready.md"), rules)).toEqual({
      status: "ready", footerSha: "3a5a2ab",
      dashboardUrl: "https://dashboard-fixture.example.test", adminUrl: "https://admin-fixture.example.test", apiUrl: "https://api-server-pr-1242.example.test",
    });
  });
  it("takes the footer SHA, not the PR head quoted in the stale warning", () => {
    expect(parseSandboxComment(fx("sandbox-comment-ready-stale.md"), rules)!.footerSha).toBe("3a5a2ab");
  });
  it("recognises torn down and unrelated comments", () => {
    expect(parseSandboxComment(fx("sandbox-comment-down.md"), rules)).toMatchObject({ status: "torn_down", footerSha: null });
    expect(parseSandboxComment("looks good to me", rules)).toBeNull();
  });
  it("follows the file: a different marker no longer matches", () => {
    expect(parseSandboxComment(fx("sandbox-comment-ready.md"), { ...rules, marker: "<!-- other -->" })).toBeNull();
  });
});

describe("shaMatches", () => {
  it("accepts equal and 7+ char prefixes only", () => {
    expect(shaMatches(HEAD, HEAD)).toBe(true);
    expect(shaMatches("3a5a2ab", HEAD)).toBe(true);
    expect(shaMatches("3a5a2a", HEAD)).toBe(false);
    expect(shaMatches("deadbee", HEAD)).toBe(false);
  });
});

describe("resolvePrEnv", () => {
  it("returns the comment's own dashboard URL and the head SHA", () => {
    const env = resolvePrEnv(pr({ comments: [comment(fx("sandbox-comment-ready.md"))] }), rules);
    expect(env).toMatchObject({ kind: "pr-sandbox", baseUrl: "https://dashboard-fixture.example.test", prNumber: 9, headSha: HEAD, apiUrl: "https://api-server-pr-1242.example.test" });
  });
  it("ignores a matching comment by another author", () => {
    expect(() => resolvePrEnv(pr({ comments: [comment(fx("sandbox-comment-ready.md"), "someone")] }), rules)).toThrow(EnvError);
  });
  it("uses the latest matching comment", () => {
    const env = resolvePrEnv(pr({ comments: [comment(fx("sandbox-comment-down.md")), comment(fx("sandbox-comment-ready.md"))] }), rules);
    expect(env.kind).toBe("pr-sandbox");
  });
  it("fails, naming the PR, when there is no comment, it is torn down, or the SHA is behind", () => {
    const cases = [
      pr(),
      pr({ comments: [comment(fx("sandbox-comment-down.md"))] }),
      pr({ headSha: "f".repeat(40), comments: [comment(fx("sandbox-comment-ready.md"))] }),
    ];
    for (const c of cases) {
      const err = (() => { try { resolvePrEnv(c, rules); return null; } catch (e) { return e as EnvError; } })();
      expect(err).toBeInstanceOf(EnvError);
      expect(err!.exitCode).toBe(2);
      expect(err!.message).toContain(c.url);
    }
  });
});

describe("stagingEnv", () => {
  it("reads E2E_BASE_URL and E2E_API_URL from the environment", () => {
    expect(stagingEnv({ E2E_BASE_URL: "https://x.test", E2E_API_URL: "https://api.x.test" })).toEqual({ kind: "staging", baseUrl: "https://x.test", apiUrl: "https://api.x.test" });
  });
  it("fails naming E2E_BASE_URL when it is unset", () => {
    expect(() => stagingEnv({})).toThrow(/E2E_BASE_URL/);
  });
});
