# `qa extract` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `qa extract` real: read a ticket / PR / goal, resolve the test environment mechanically, have the LLM propose acceptance atoms and a change model, and write only what code has verified into `acceptance.json`, `change-model.json`, `env.json` (plus `extract-report.json` listing what was dropped and why).

**Architecture:** Pure functions for everything with a rule (anchor matching, PR candidate filtering, sandbox comment parsing, SHA gate). I/O sits behind small injected interfaces (`LlmTransport`, `FetchLike`, `ExecLike`) so every task is tested without network. The LLM only proposes; code verifies (spec §12).

**Tech Stack:** TypeScript, zod 4.5.4, vitest 4.1.11, `openai` SDK (new dependency, used only in one adapter file), `gh` CLI via an injected exec function, Linear GraphQL via an injected fetch.

**Spec:** `docs/superpowers/specs/2026-11-06-qa-harness-cli-design.md` (sections 4.4, 4.8, 4.13, 5 "qa extract", 7, 12). Runbook rules: `runbook/references/intake-routing.md` §2, `runbook/references/pr-driven-intake.md`, `runbook/references/goal-driven-intake.md`, `runbook/QA-models/_workflow/qa-environment.md` §5.

## Global Constraints

- Every acceptance atom carries `sourceRef` and a **verbatim `anchor`**; code and PR diff can only produce candidates, never Expected sources (spec §5).
- Anchor check: normalise whitespace and Markdown marks on both source and anchor, compare in the source's original language; the prompt must say "anchor must be copied from the source, never translated" (spec §4.13).
- An atom whose anchor is not found is **not written**; the reason is recorded in `extract-report.json` (spec §12, user-confirmed).
- Environment resolution is mechanical (spec §5, intake-routing §2): expand candidate PRs; **exclude merged PRs**; find the comment containing `<!-- preview-sandbox -->` authored by `github-actions`; status `Sandbox ready` / `Sandbox torn down`; footer SHA must equal the PR head SHA, a short footer SHA counts only if it is a unique prefix of the head SHA; mismatch fails. Sandbox URLs come from the comment, never guessed or constructed. Goal mode uses the configured staging environment.
- Never create a sandbox. (Refreshing an existing one with `/sandbox` is allowed by the Runbook but is **not** implemented in this plan; a stale SHA just fails.)
- Linear via API (`LINEAR_API_KEY`) and PR data via `gh`; `--ticket-file` supplies ticket text offline (spec §4.8).
- LLM: OpenAI SDK, JSON-Schema structured output, validated by zod before use, `llm.maxRetries` retries, then exit (spec §4.4). The LLM never reads files or env and never sees secrets.
- Non-interactive: where the Runbook says "stop and ask the user", exit non-zero with the reason (spec §7).
- Exit codes: bad input/state (no live sandbox, merged PR, SHA mismatch, no atoms survived) → `2`; OpenAI/Linear/GitHub failures → `3`.
- No secret value in any artifact or log.

## Review Focus

1. The LLM returns an anchor that is a paraphrase or translation of the source: atom dropped, recorded in `extract-report.json`, not written.
2. The anchor differs from the source only by whitespace, line breaks, or Markdown marks (`**`, backticks, list bullets): accepted.
3. Every candidate PR is merged, or the only comment says `Sandbox torn down`: exit 2 naming the PR, no `env.json` written.
4. Footer SHA is a short prefix that matches two different PR heads, or matches none: exit 2.
5. `--ticket-file` given and `LINEAR_API_KEY` empty: works (only `OPENAI_API_KEY` is needed); `--ticket DEV-1` without the key: exit 2 naming the key.

---

### Task 1: LLM structured-call wrapper

**Files:**
- Create: `src/llm/structured.ts`, `src/llm/openai-transport.ts`, `tests/llm-structured.test.ts`
- Modify: `package.json` (add `openai` dependency, exact version pin)

**Interfaces:**
- Produces:
  - `type LlmRequest = { system: string; user: string; schemaName: string; jsonSchema: object }`
  - `interface LlmTransport { complete(req: LlmRequest): Promise<string> }` (returns the model's raw JSON text; throws `LlmTransportError` on HTTP/network failure)
  - `class LlmError extends Error { exitCode: 3 }`
  - `callStructured<T>(opts: { transport: LlmTransport; schema: z.ZodType<T>; schemaName: string; system: string; user: string; maxRetries: number }): Promise<T>`: converts the zod schema with `z.toJSONSchema`, calls the transport, `JSON.parse` + `schema.parse`; on parse/validation failure retries up to `maxRetries` times (total attempts `maxRetries + 1`), then throws `LlmError` that includes the last zod message but **not** the model output verbatim beyond 200 characters; transport errors are not retried more than `maxRetries` either.
  - `makeOpenAiTransport(opts: { apiKey: string; baseUrl: string; model: string }): LlmTransport` in `openai-transport.ts`.

- [ ] **Step 1: Write failing tests** with a fake transport: valid JSON on attempt 1 returns the parsed object; invalid JSON then valid returns on attempt 2 and the transport was called twice; always-invalid with `maxRetries: 2` throws `LlmError` after exactly 3 calls; a schema mismatch (missing field) counts as invalid; `LlmError.exitCode === 3`; the error message never contains the full 500-character fake output.
- [ ] **Step 2: Run `pnpm vitest run tests/llm-structured.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `callStructured`** as specified.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Implement `makeOpenAiTransport`** with the `openai` SDK (`baseURL` from config, JSON-schema response format, `temperature` left to the model default). It is not unit-tested against the network; add one test asserting it throws `LlmTransportError` when the SDK call rejects (inject a fake client through an optional `client` parameter).
- [ ] **Step 6: Commit** — `feat: structured LLM calls with validation and bounded retries`.

### Task 2: Anchor normalisation and verification

**Files:**
- Create: `src/anchor.ts`, `tests/anchor.test.ts`

**Interfaces:**
- Produces: `normalizeForAnchor(text: string): string`; `anchorInSource(source: string, anchor: string): boolean`. Normalisation: collapse all whitespace runs to one space, strip Markdown emphasis/code marks (`*`, `_`, backtick), strip list bullets and heading `#` at line starts, trim, case-sensitive. An empty or whitespace-only anchor is never found.

- [ ] **Step 1: Write failing tests** — exact substring found; anchor with different line breaks found; anchor missing `**bold**` marks found; source with `- item` bullet found against anchor without the bullet; a paraphrase not found; an English translation of a Chinese source sentence not found; empty anchor not found; anchor that is found only after case change is **not** found.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the two functions.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: verbatim anchor verification`.

### Task 3: Source loaders (ticket file, Linear, GitHub)

**Files:**
- Create: `src/sources/types.ts`, `src/sources/ticket-file.ts`, `src/sources/linear.ts`, `src/sources/github.ts`, `tests/sources.test.ts`

**Interfaces:**
- Produces:
  - `type SourceDoc = { ref: string; title: string; text: string }` (`ref` is a stable string used as `sourceRef`, e.g. `linear:DEV-123`, `file:<abs path>`, `pr:<url>#description`)
  - `type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>`
  - `type ExecLike = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>`
  - `loadTicketFile(path: string): SourceDoc` (throws `ConfigError` naming the path if unreadable or empty)
  - `fetchLinearIssue(opts: { id: string; apiKey: string; fetch: FetchLike }): Promise<SourceDoc>` (GraphQL `issue(id:)`, title + description + comments concatenated; non-2xx or GraphQL `errors` → `ExternalError` exit 3)
  - `type PrInfo = { url: string; number: number; repo: string; state: "OPEN" | "MERGED" | "CLOSED"; headSha: string; baseSha: string; description: string; comments: { author: string; body: string; url: string }[] }`
  - `fetchPr(opts: { url: string; exec: ExecLike }): Promise<PrInfo>` (via `gh pr view <url> --json number,state,headRefOid,baseRefOid,body,comments,url`; non-zero exit → `ExternalError`)
  - `class ExternalError extends Error { exitCode: 3 }` (shared with Task 1's `LlmError`; define once in `src/errors.ts` and make `LlmError` extend it).

- [ ] **Step 1: Write failing tests** — `loadTicketFile` returns text and `ref` for a temp file, throws naming the path for a missing/empty file; `fetchLinearIssue` with a fake fetch sends the `Authorization` header with the key and returns title + description + comments; a 401 and a GraphQL `errors` response both throw `ExternalError` whose message does **not** contain the API key; `fetchPr` with a fake exec parses the JSON into `PrInfo` (state `MERGED` preserved); `gh` exit 1 throws `ExternalError` naming the PR URL.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the loaders and `src/errors.ts`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: ticket, Linear and GitHub source loaders`.

### Task 4: Environment resolution

**Files:**
- Create: `src/env-resolve.ts`, `tests/fixtures/sandbox-comment-ready.md`, `tests/fixtures/sandbox-comment-down.md`, `tests/env-resolve.test.ts`
- Modify: `src/config.ts` (add optional `staging: { baseUrl }`, default `https://app-staging.hellyeahai.com`), `tests/config.test.ts`

**Interfaces:**
- Consumes: `PrInfo`, `Env` (from `src/contracts/env.ts`; extend it with `dashboardUrl?`, `adminUrl?`, `apiUrl?` strings, all optional).
- Produces:
  - `selectCandidates(prs: PrInfo[]): { open: PrInfo[]; excluded: { pr: PrInfo; reason: string }[] }` (merged and closed PRs excluded with reason)
  - `parseSandboxComment(body: string): { status: "ready" | "torn_down"; footerSha: string | null; dashboardUrl?: string; adminUrl?: string; apiUrl?: string } | null` (null when the body lacks `<!-- preview-sandbox -->`)
  - `resolvePrEnv(pr: PrInfo): Env` (finds the bot comment authored by `github-actions` with the marker, takes the **latest** matching one; throws `EnvError` exit 2 when none, when `torn_down`, when the footer SHA is missing, or when the SHA gate fails)
  - `shaMatches(footerSha: string, headSha: string): boolean` (equal, or `footerSha` is a prefix of `headSha` with at least 7 characters)
  - `stagingEnv(baseUrl: string): Env` (`kind: "staging"`)
  - `class EnvError extends Error { exitCode: 2 }`

- [ ] **Step 1: Get a real fixture.** Read one recent `<!-- preview-sandbox -->` comment from a Hellyeah PR with `gh pr view <url> --json comments` (read-only) and save its body, with any tokens removed, as `tests/fixtures/sandbox-comment-ready.md`; save a torn-down one as `...-down.md`. If `gh` has no access to the repository, stop and ask the human to paste one; do **not** invent the comment format. The parser regexes are written against these files, not against the Runbook prose.
- [ ] **Step 2: Write failing tests** — `selectCandidates` excludes MERGED with a reason naming the PR; `parseSandboxComment` returns `ready` with the three URLs and footer SHA for the ready fixture, `torn_down` for the down fixture, `null` for an unrelated comment; `shaMatches("abc1234", "abc1234ff…")` true, an unrelated SHA false, a 6-character prefix false; `resolvePrEnv` returns `Env` with `headSha` set and `baseUrl` equal to the **comment's** dashboard URL (never constructed from the PR number); a comment authored by someone other than `github-actions` is ignored; every failure case in Review Focus 3 and 4 throws `EnvError` naming the PR URL and writes nothing; `stagingEnv` uses the configured URL.
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement** the functions.
- [ ] **Step 5: Run, expect PASS.**
- [ ] **Step 6: Commit** — `feat: mechanical environment resolution with SHA gate`.

### Task 5: Extraction (LLM proposes, code verifies)

**Files:**
- Create: `src/extract/prompts.ts`, `src/extract/extract.ts`, `tests/extract.test.ts`
- Modify: `src/contracts/` (add `extract-report.ts`: `{ dropped: { text: string; sourceRef: string; anchor: string; reason: string }[]; sources: { ref: string; title: string }[] }`), `src/run-dir.ts` (register `extract-report.json`)

**Interfaces:**
- Consumes: `callStructured`, `LlmTransport`, `anchorInSource`, `SourceDoc`, `Acceptance`, `ChangeModel`, `Runbook` (`runbook.text(...)`).
- Produces: `extractFromSources(opts: { transport: LlmTransport; runbook: Runbook; sources: SourceDoc[]; maxRetries: number }): Promise<{ acceptance: Acceptance; changeModel: ChangeModel; report: ExtractReport }>`.
  - The LLM response schema is `{ atoms: { text, sourceRef, anchor }[]; changeModel: ChangeModel }`; `sourceRef` must be one of the provided `sources[].ref`, otherwise the atom is dropped with reason `unknown sourceRef`.
  - Code verifies each atom with `anchorInSource(source.text, anchor)`; failures go to `report.dropped` with reason `anchor not found in source`; survivors get ids `A01`, `A02`, … in order.
  - The system prompt (in `prompts.ts`) contains the verbatim rule "anchor must be copied from the source text exactly; never translate or paraphrase" and the Runbook's `references/knowledge-sources.md` text; the user prompt contains only the source texts. No secret or file path is placed in a prompt.

- [ ] **Step 1: Write failing tests** with a fake transport returning canned JSON: an atom with an exact anchor survives with id `A01`; an atom whose anchor is a paraphrase is dropped and appears in `report.dropped`; an atom whose anchor differs only by Markdown marks survives; an atom citing a `sourceRef` that was not supplied is dropped; zero surviving atoms returns an empty `acceptance.atoms` (the caller decides what that means); the prompt string captured by the fake transport contains "never translate" and does not contain any value from a `secrets` env passed to the test.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** prompts and `extractFromSources`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: LLM extraction with code-verified anchors`.

### Task 6: Wire `qa extract`

**Files:**
- Modify: `src/commands/types.ts` (add `args: Record<string, string | boolean | undefined>` to `CommandContext`), `src/commands/extract.ts`, `src/cli.ts` (extract options), `src/commands/index.ts`, `tests/cli.test.ts`
- Create: `tests/extract-command.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5, `createRunDir`, `writeArtifact`, `requireSecrets`.
- Produces: `qa extract --feature <f> --run-id <id> (--ticket <LINEAR-ID> | --ticket-file <path> | --pr <url> | --goal <text>) [--force]`. Exactly one of the four inputs is required, otherwise exit 2 naming the choices. Behaviour per input:
  - `--ticket-file`: source = file; environment = `stagingEnv` (no PR is known), `env.kind = "staging"`.
  - `--ticket`: needs `LINEAR_API_KEY` (exit 2 naming it when empty); source = Linear issue; PRs linked in the issue text (GitHub PR URLs) are fetched and run through `selectCandidates` and `resolvePrEnv`; no linked PR → `stagingEnv` and the report notes it.
  - `--pr`: source = PR description + author comments; environment via `resolvePrEnv`.
  - `--goal`: source = the goal text plus `QA-models/hellyeah/core-journeys.md` from the Runbook; environment = `stagingEnv`.
  - Writes `env.json`, `acceptance.json`, `change-model.json`, `extract-report.json` via `writeArtifact` (all validated). Zero surviving atoms → exit 2 with the dropped reasons printed, `extract-report.json` still written, `acceptance.json` **not** written. Success → exit 0.
  - `LlmError`/`ExternalError` → exit 3; `EnvError`/`ConfigError` → exit 2. Run dir is created before any network call.
  - A `qa extract` exit-0 run must be consumable by `qa design`: `acceptance.json` exists, so Task 5 of the foundation plan's input check passes.

- [ ] **Step 1: Write failing tests** driving `runExtract(ctx, deps)` where `deps = { transport, fetch, exec }` are injected (the CLI builds the real ones): `--ticket-file` with a fake transport writes the four artifacts and returns 0; surviving atom ids are `A01…`; a transport returning only un-anchored atoms returns 2, writes `extract-report.json`, and does not write `acceptance.json`; `--ticket DEV-1` with no `LINEAR_API_KEY` returns 2 naming the key (Review Focus 5) while `--ticket-file` with the key unset succeeds; `--pr` with a merged PR returns 2 and writes no `env.json`; a transport that always fails returns 3; passing two inputs (`--ticket-file` and `--pr`) returns 2; no secret value appears in any written file (grep the run dir for the fake key).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `runExtract`, make `extractStage.run` build real dependencies (`makeOpenAiTransport`, global `fetch`, `child_process` exec) and call it.
- [ ] **Step 4: Extend `tests/cli.test.ts`** — `qa extract` without any input option exits 2 and names the four options; update the existing "extract not implemented" tests to the new behaviour.
- [ ] **Step 5: Run `pnpm test && pnpm tsc --noEmit`.** Expected: all pass, clean.
- [ ] **Step 6: Manual check with a real key (human or agent with the key):** `OPENAI_API_KEY=... pnpm qa extract --config qa-harness.config.json --feature DEMO --run-id r1 --ticket-file <a real ticket text file>`. Expected: exit 0, `acceptance.json` atoms whose anchors all appear in the file. Record the result in the PR description; this is the only step that touches the real OpenAI API.
- [ ] **Step 7: Commit** — `feat: qa extract`.

---

## Self-Review

- **Spec coverage:** §5 extract outputs (`acceptance.json`, `change-model.json`, `env.json`) T5/T6; env resolution rules T4; Linear/`gh`/`--ticket-file` T3; anchor normalisation §4.13 T2; structured output and retries §4.4 T1; §12 division of labour (LLM proposes, code verifies, un-anchored atoms dropped with reasons) T5; exit codes §7 T6. Goal mode source is `core-journeys.md` per §4.14. Not covered: refreshing a stale sandbox with `/sandbox`, PR `pr-spec.json` snapshots with 40-character SHAs, the omission-hook file inventory (all non-goals or later), `qa design` and later stages.
- **Open item for the human:** the sandbox bot comment format is not documented in the Runbook; Task 4 Step 1 needs one real comment (or a pasted one). Also confirm the default staging URL `https://app-staging.hellyeahai.com` (taken from the executor's config default).
- **Added artifact:** `extract-report.json` is not in spec §5's file list; it is where "record the reason" lands. Later plans (`report`) should read it for the uncovered-atoms section.
- **Type consistency:** `SourceDoc`/`PrInfo`/`ExternalError` (T3) used in T4–T6; `Env` extended in T4 and written in T6; `ExtractReport` defined in T5 and registered in `run-dir.ts`; `CommandContext.args` added in T6 and used only there.
- **Proportion:** six tasks, signatures and assertions only; no function bodies.
