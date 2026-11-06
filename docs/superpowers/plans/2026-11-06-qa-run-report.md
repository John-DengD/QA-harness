# `qa run` and `qa report` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** `qa run` executes the kept cases, one E2B Desktop sandbox per case, with a recording per case, deterministic verdicts, and generated Playwright scripts for cases without one; `qa report` assembles `report.md` from the artifacts without re-judging.

**Architecture:** `src/run/` holds pure logic (verdict mapping, script matching, side-effect gate, redaction, orchestration) behind injected interfaces (`SandboxDriver`, `PlaywrightRunner`, `RunRegistry`, `ScriptValidator`, `LlmTransport`). Real implementations (`src/run/real-deps.ts` + `executor/scripts/qa-sandbox.ts`) shell out to the migrated executor. The LLM is used for exactly one thing: writing a Playwright script for a case without one (spec §12).

**Tech Stack:** unchanged; `@e2b/desktop` is used only inside `executor/`.

**Spec:** `docs/superpowers/specs/2026-11-06-qa-harness-cli-design.md` §4.9–4.10, §5 (run, report), §7, §9, §12, §13.

## Global Constraints

- Only cases with review verdict `keep` run (`cases.reviewed.json`). `testability.state` `Blocked` → verdict `Blocked`, `NotApplicable` → `NotApplicable`; neither is executed.
- Each executed case gets its own sandbox and its own recording from the first business UI action; the recorder is stopped in `finally` and the video must exist and be non-empty, otherwise the verdict becomes `Automation failure` (spec §5).
- Verdict mapping is deterministic, no LLM (spec §4.10, §12): script passes → `Pass`. Assertion failure → `ProductFail` only when the case's Expected source is a ticket, a PR author's statement or the user (`linear:`, `file:`, `pr:`, `goal:` refs), or a Runbook module whose `status` is `active`; a Runbook module that is `pilot`/`draft` → `Inconclusive`. Timeout, selector error, sandbox or network error → `Automation failure`. A result from a **generated** script is flagged `generated` and its assertion failures are always `Inconclusive`.
- Assertion failure vs automation error: an error whose message contains `expect(` followed by a `.to…` matcher, and which is not a test timeout, is an assertion failure; every other failure (locator timeouts in actions, test timeout, target closed, non-zero exit without a Playwright error) is automation.
- A case with no existing script (looked up in `runbook/script-bindings.json` by exact normalised title) and no valid generated script is `not_automated`: not executed, no result file, listed in `run-summary.json` (spec §5).
- Generated scripts: LLM writes them from the case and a live DOM snapshot; code type-checks them and runs `playwright test --list` on them; bounded retries; saved under `<runDir>/generated-specs/`; never written into `executor/tests/`. Side effects the script declares must all be in `runbook/authorized-side-effects.json`, else the case is `Blocked` (spec §9).
- Script stdout/stderr are saved only after redacting every secret value of the environment (spec §5, §9); no secret in any artifact.
- The run must be registered with the executor's run registry (`loop:state init`, registry under `<runRoot>/.qa-loop`) before any case executes; `E2E_TEST_OUTPUT_DIR` is the case evidence directory under the run directory.
- Timeouts: `run.caseTimeoutMs` per case and `run.totalTimeoutMs` overall; cases not started when the total expires are listed as `skipped` in `run-summary.json`.
- Exit codes (spec §7): `10` any `ProductFail`; else `20` if any `Blocked`, `Inconclusive`, `Automation failure`, `not_automated` or skipped case; else `0`; external failures `3`; invalid input `2`.
- `qa report` only aggregates; it contains the fixed independence statement and never claims post-execution independent review (spec §2 anti-goal).
- Environment facts (addresses, markers) are never hard-coded in `src/` (spec §13).

## Review Focus

1. A recording that is missing or 0 bytes after a "passing" script: the case is `Automation failure`, never `Pass`.
2. An assertion failure on a case whose Expected comes only from a `pilot`/`draft` Runbook module, or from a generated script: `Inconclusive`, not `ProductFail`.
3. A secret value (E2B or OpenAI key, password) appearing in script output: redacted before it is written.
4. The total timeout expires mid-run: remaining cases are `skipped`, exit code is 20 not 0.
5. A generated script that declares an unauthorised side effect: never executed, case `Blocked`.

---

### Task 1: Verdict mapping and Playwright result classification

**Files:** Create `src/run/verdict.ts`, `tests/verdict.test.ts`

**Interfaces:**
- `type FailureKind = "assertion" | "automation"`; `classifyPlaywrightReport(report: unknown, exitCode: number, timedOut: boolean): { outcome: "passed" } | { outcome: "failed"; kind: FailureKind; message: string }` (reads the Playwright JSON reporter structure `suites → specs → tests → results → status/error`; `timedOut` or missing/unparsable report with non-zero exit → automation).
- `expectedSourceKind(sourceRef: string, runbook: { modules: ModuleMeta[] }): "authoritative" | "weak"` (`linear:`/`file:`/`pr:`/`goal:` → authoritative; `runbook:<path>` → authoritative only if the module at that path has status `active`; unknown prefix → weak).
- `mapVerdict(input: { classification: ReturnType<typeof classifyPlaywrightReport>; sourceKind: "authoritative" | "weak"; generated: boolean; recordingOk: boolean }): { verdict: Verdict; notes?: string }`.
- `summaryExitCode(results: { verdict: Verdict }[], extra: { notAutomated: number; skipped: number }): number`.

- [ ] **Step 1: Write failing tests** — pass + recording ok → Pass; pass + recording missing → Automation failure with note (Review Focus 1); assertion failure + authoritative + not generated → ProductFail; assertion + weak → Inconclusive; assertion + generated → Inconclusive (Review Focus 2); automation failure → Automation failure; classification: a JSON report with an error "Error: expect(locator).toHaveText(expected) failed" → assertion; "Test timeout of 1200000ms exceeded" → automation; "locator.click: Timeout 20000ms exceeded" → automation; `timedOut: true` → automation; unparsable report with exit 1 → automation; `expectedSourceKind` for each prefix and for `runbook:QA-models/hellyeah/core-journeys.md` (draft → weak); `summaryExitCode`: ProductFail present → 10 even with Blocked; only Pass/NotApplicable → 0; any Inconclusive → 20; `notAutomated: 1` alone → 20; `skipped: 1` alone → 20.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.** **Step 5: Commit** — `feat: deterministic verdict mapping`.

### Task 2: Script matching, side-effect gate, script generation

**Files:** Create `src/run/scripts.ts`, `src/run/generate.ts`, `runbook/script-bindings.json` (`{ "bindings": [] }`), `runbook/authorized-side-effects.json`, `tests/scripts.test.ts`, `tests/generate.test.ts`; modify `src/runbook.ts` (both JSON files are required Runbook files) and `tests/runbook.test.ts` fixture builder.

**Interfaces:**
- `loadBindings(runbook): { title: string; spec: string; grep?: string }[]`; `findExistingScript(c: Case, bindings): { spec: string; grep?: string } | null` (exact match after trimming and collapsing whitespace, case-insensitive).
- `loadAuthorizedSideEffects(runbook): string[]` (file `{ "authorized": string[] }`, initial value taken from `qa-environment.md`: the pre-authorised wallet top-up, named `wallet-top-up`); `gateSideEffects(declared: string[], authorized: string[]): { ok: true } | { ok: false; unauthorized: string[] }`.
- `type ScriptValidator = (specPath: string) => Promise<{ ok: boolean; output: string }>` (real one: `tsc --noEmit` of the file plus `playwright test --list`).
- `generateScript(opts: { transport: LlmTransport; case: Case; domSnapshot: string; baseUrl: string; validate: ScriptValidator; writeSpec: (code: string) => Promise<string>; maxRetries: number }): Promise<{ ok: true; specPath: string; sideEffects: string[]; code: string } | { ok: false; reason: string }>`: LLM schema `{ code: string; sideEffects: string[] }`; the validator output of a failed attempt is fed back into the next attempt's prompt; the prompt contains the case (preconditions, expected), the DOM snapshot truncated to 60 000 characters, the base URL, and the rules "use only `@playwright/test` `test`/`expect` from `../../src/fixtures`... " as the executor's specs do, "declare every side effect in `sideEffects`", "assertions must check the case's Expected text". Never includes a secret.

- [ ] **Step 1: Write failing tests** — binding match is case/whitespace-insensitive, no match → null; `gateSideEffects(["wallet-top-up"], ["wallet-top-up"])` ok, `["submit-payment"]` not ok naming it (Review Focus 5); `generateScript` with a fake transport and a validator that fails once then passes → two LLM calls, second prompt contains the first validator output, returns ok with the spec path; validator always failing with `maxRetries: 1` → `ok: false` after 2 attempts and the reason includes the last validator output (clipped); the prompt never contains the DOM beyond 60 000 characters and contains the expected text; runbook without the two JSON files fails `loadRunbook`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.** **Step 5: Commit** — `feat: script matching, side-effect gate and script generation`.

### Task 3: Run orchestration

**Files:** Create `src/run/run-cases.ts`, `src/run/types.ts`, `src/contracts/run-summary.ts` (`{ executed: string[]; notAutomated: { caseId; reason }[]; skipped: { caseId; reason }[]; blocked: { caseId; reason }[]; startedAt; finishedAt }`), `tests/run-cases.test.ts`; register `run-summary.json` in `src/run-dir.ts`; extend `CaseResult` with optional `generated`-flag already present and `evidenceDir`.

**Interfaces (`types.ts`):**
- `interface SandboxDriver { create(opts: { url: string }): Promise<{ sandboxId: string }>; startRecording(sandboxId: string, caseDir: string): Promise<void>; stopRecording(sandboxId: string, caseDir: string): Promise<{ videoPath: string; bytes: number }>; snapshot(sandboxId: string, origin: string): Promise<string>; kill(sandboxId: string): Promise<void> }`
- `interface PlaywrightRunner { run(opts: { sandboxId: string; specPath: string; grep?: string; outputDir: string; timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<{ exitCode: number; stdout: string; stderr: string; reportJson: unknown | null; timedOut: boolean }> }`
- `interface RunRegistry { register(opts: { runDir: string; runId: string; feature: string; env: Env; taskModelRef: string }): Promise<void> }`
- `runCases(opts: { cases: Case[]; env: Env; runbook: Runbook; runDir: string; runId: string; feature: string; secrets: string[]; deps: { sandbox; playwright; registry; validate: ScriptValidator; transport: LlmTransport }; limits: { caseTimeoutMs; totalTimeoutMs; maxRetries }; now?: () => number }): Promise<{ results: CaseResult[]; summary: RunSummary; exitCode: number }>`.
- Per case, in order: `Blocked`/`NotApplicable` by testability (no sandbox); find existing script, else (create sandbox → snapshot → `generateScript`; generation failure → `not_automated`; unauthorised side effect → `Blocked`); sandbox created once per executed case; `startRecording` before the Playwright call; Playwright output saved redacted to `<caseDir>/playwright.stdout.txt` and `.stderr.txt`; `stopRecording` in `finally`; `kill` in `finally`; verdict via Task 1; `results/<caseId>.json` written with `generated`. The run is registered once before the first case.

- [ ] **Step 1: Write failing tests** with fake deps (record call order): existing-script case passes → Pass, result written, sandbox killed, recording stopped; recording stop returns 0 bytes → Automation failure (Review Focus 1); recording stop throws → Automation failure and the sandbox is still killed; Playwright run throws → Automation failure, `finally` steps ran; a secret in fake stdout is absent from the saved file (Review Focus 3); no script and generation fails → `not_automated`, no result file, listed in summary, exit 20; generated script passing → result `generated: true`; generated script assertion failure → Inconclusive; unauthorised side effect → `Blocked`, Playwright never called (Review Focus 5); testability `Blocked`/`NotApplicable` → no sandbox created; total timeout (fake clock) → later cases `skipped`, exit 20 (Review Focus 4); `ProductFail` result → exit 10; registry registered exactly once, before the first sandbox.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.** **Step 5: Commit** — `feat: run orchestration`.

### Task 4: Real dependencies

**Files:** Create `executor/scripts/qa-sandbox.ts`, `src/run/real-deps.ts`, `tests/real-deps.test.ts`; modify `scripts/migrate-executor.sh` (copy `qa-sandbox.ts` from `scripts/executor-extra/` after the rsync so re-migration keeps it) and keep the canonical copy at `scripts/executor-extra/qa-sandbox.ts`; modify `executor/package.json` script list via the migrate script (`"qa:sandbox": "tsx scripts/qa-sandbox.ts"`).

**Interfaces:**
- `qa-sandbox.ts` commands, JSON on stdout, errors to stderr with non-zero exit: `create --url <origin> [--width 1440 --height 900 --timeout-seconds 1800]` → `{ sandboxId }` (same sequence as the original `e2b-computer-use create`: `Sandbox.create` with `buildE2bTestenv(process.env)`, private traffic, launch Chrome with `chromeLaunchCommand`, wait for `discoverPrivateCdp`); `record-start --sandbox-id <id> --case-dir <dir>` (ffmpeg `x11grab` as the original, state in `<dir>/recording.json`, run must be registered via `assertRegisteredRun`); `record-stop --sandbox-id <id> --case-dir <dir>` → `{ video, bytes, durationSeconds }` (ffprobe duration > 0, sha256 verified stream via `saveVerifiedVideoStream`); `snapshot --sandbox-id <id> --origin <url>` → page DOM text from the shared Chrome via `connectSharedChrome` + `selectUniqueTargetPage`; `kill --sandbox-id <id>`.
- `src/run/real-deps.ts`: `makeSandboxDriver(opts: { executorRoot: string; env: NodeJS.ProcessEnv; exec: ExecLike }): SandboxDriver`; `makePlaywrightRunner(opts: { executorRoot; env; spawn })`: runs `pnpm exec tsx scripts/run-e2b-playwright.ts <sandboxId> <spec> [--grep ...] --reporter=json --output=<dir>` with `cwd = executorRoot`, `E2E_TEST_OUTPUT_DIR`, kills it on timeout, parses the JSON report from stdout; `makeRegistry(opts: { executorRoot; qaRoot: string; env; exec })`: `pnpm loop:state init --qa-root <qaRoot> --run-id <runId> --run-root <feature>/runs/<runId> --journey-key <feature> --mode regression --feature <feature> --environment <env.kind> --role qa --org-alias default --sha <headSha or "none"> --executor-id qa-harness --task-model <feature>/runs/<runId>/cases.reviewed.json`, all identifier values sanitised to the executor's `[A-Za-z0-9._-]` rule; `makeScriptValidator(opts: { executorRoot; exec })`: `tsc --noEmit` on the file with the executor tsconfig plus `playwright test --list`.
- Tested without network: command lines built by each factory (injected `exec`/`spawn` capture arguments, cwd and env), JSON parsing, timeout kill, sanitising; plus `tsc --noEmit` in `executor/` and a smoke test that `executor/scripts/qa-sandbox.ts` has the five commands and exits non-zero with usage on an unknown one.

- [ ] **Step 1: Write failing tests** as above. **Step 2: Run, expect FAIL.** **Step 3: Implement** (port the sandbox/recording logic from the original script as described; keep identifiers and error messages). **Step 4: Run `pnpm test`; run `pnpm typecheck` in `executor/`.** Expected: PASS, clean. **Step 5: Commit** — `feat: real sandbox, runner and registry adapters`.

### Task 5: `qa run`

**Files:** Modify `src/commands/run.ts`, `src/cli.ts` if options are needed, `tests/cli.test.ts`; Create `tests/run-command.test.ts`.

**Interfaces:** `runRun(ctx: CommandContext, deps: RunDeps): Promise<number>` reads `cases.reviewed.json` (required), `env.json` (required), builds the secret list from **both** env files (every value of keys matching `KEY|SECRET|TOKEN|PASSWORD` in `ctx.env`), calls `runCases`, writes `run-summary.json`; `runStage.run` builds the real deps (`makeSandboxDriver`, `makePlaywrightRunner`, `makeRegistry`, `makeScriptValidator`, OpenAI transport). Needs `E2B_API_KEY` and `OPENAI_API_KEY` (already declared). A missing `env.json` exits 2 naming it; an empty `cases.reviewed.json` exits 0 with a note.

- [ ] **Step 1: Write failing tests** with fake deps — end to end over a temp run dir: two cases (one Pass via binding, one ProductFail) → results files, summary, exit 10; missing `env.json` → 2 naming it; secrets from `ctx.env` are redacted in saved output; empty cases → 0.
- [ ] **Step 2–4:** run, implement, run. **Step 5: Commit** — `feat: qa run`.

### Task 6: `qa report`

**Files:** Create `src/report/report.ts`, `tests/report.test.ts`; modify `src/commands/report.ts`.

**Interfaces:** `buildReport(input: { feature; runId; env: Env; acceptance; cases: Case[]; review: CaseReviewEntry[]; results: CaseResult[]; summary: RunSummary | null; extractReport: ExtractReport | null; generators: GeneratorsFile | null }): string` (Markdown, deterministic, no LLM); `runReport(ctx): Promise<number>` writes `report.md` and returns the exit code `summaryExitCode(...)` so `qa report` alone reproduces the run's code. Sections: overall conclusion (counts per verdict, exit-code meaning), case table (id, title, generator, verdict, `generated` mark), failed/blocked cases with repro (preconditions + expected + evidence dir), not covered (dropped by review with reasons, `not_automated`, skipped, trimmed over budget, candidate pool, extract-dropped atoms), coverage statistics (atoms → cases → executed → passed), and the fixed **independence statement**: "执行前的 case 清单经过一次独立审核;执行后的结论(Pass、ProductFail 等)没有经过独立复核,未经人工核对。" The word "已独立复核" must not appear.

- [ ] **Step 1: Write failing tests** — a fixture with a Pass, a ProductFail, a generated Inconclusive, one review drop with reason, one not_automated, one trimmed case: every element appears; the statement is present exactly once; the text never contains "已独立复核"; missing optional inputs (no summary) still produces a report; `runReport` writes the file and returns 10 with a ProductFail; no `results/` → exit 2 (already by the stage input check).
- [ ] **Step 2–4:** run, implement, run. **Step 5: Commit** — `feat: qa report`.

### Task 7: Pipeline dry run and README

**Files:** Create `tests/pipeline.test.ts`, `README.md`

- [ ] **Step 1: Write the pipeline test**: in one temp run dir, call `runExtract` → `runReviewLoop` ← `runDesign` → `runRun` → `runReport` in order with fake LLM transport (one transport dispatching by `schemaName`), fake fetch/exec and fake sandbox deps; assert artifacts at each hand-off (`acceptance.json`, `cases.json`, `cases.reviewed.json`, `results/*.json`, `report.md`) and that the final exit code matches the verdict mix. Run it; it must pass without network.
- [ ] **Step 2: Write `README.md`**: what the tool is, the five commands, config and the two env files (`<configDir>/.env.local`, `<configDir>/qa-env/.env.local`, variable names from the executor: `E2E_BASE_URL`, `E2B_API_KEY`, `OPENAI_API_KEY`, `LINEAR_API_KEY`, and the executor variables), where the Runbook and `environments.json` live, how to run `qa doctor` and a first `qa all --ticket-file`, exit codes, and known limits (generated-script reliability untested against live pages; `/sandbox` refresh not implemented).
- [ ] **Step 3: Run `pnpm test && pnpm tsc --noEmit` and `pnpm typecheck` in `executor/`.** Expected: all pass. **Step 4: Commit** — `test: pipeline dry run; docs: README`.

---

## Self-Review

- **Spec coverage:** §5 run (independent sandbox, recording in finally, action_unknown handling is delegated to existing Action scripts and not re-implemented here, existing-script contract with run registry and `E2E_TEST_OUTPUT_DIR`, redaction), §4.10 verdict mapping, §5 script generation sub-flow with validation and `generated` flag, §9 side-effect gate, §5 report with the independence statement, §7 exit codes, §13 no environment literals. Not covered: `action_unknown` / read-only re-verification after a side-effect timeout (needs Action-level support in the generated script prompt; the prompt tells generators to avoid blind retries, but there is no enforcement), `qa script` as a separate command, `--publish`.
- **Known unverified edges (need a live run):** the real sandbox script has never run against E2B; generated-script success rate is unknown (spec §9 asks for a measured first-pass rate); Playwright over CDP may not honour `--output` the same way as before.
- **Consistency:** `Verdict`, `CaseResult`, `Case` from the foundation contracts; `Env`, `ExtractReport`, `SourcesFile` from the extract plan; `GeneratorsFile.trimmed` is `{title, reason}` from the design plan; `ExecLike` from the sources module is reused for subprocesses.
