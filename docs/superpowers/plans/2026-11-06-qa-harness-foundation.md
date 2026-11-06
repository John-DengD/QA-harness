# qa-harness Foundation + Action Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `qa` CLI skeleton (config, `qa doctor`, Runbook loader, run-directory contracts, five command stubs) and migrate the Action/executor code from the linear-browser-qa install copy into this repo, so every later command plan builds on a working, type-checked base.

**Architecture:** One TypeScript package. `src/` holds the CLI, config, Runbook loader, contracts and run-dir logic. `runbook/` holds content (already created). `executor/` holds the migrated `hy_ui_autotest` code unchanged except for removed non-goal entry points; the CLI never imports it in this plan. Later plans (extract, design, review, run+script generation, report) are separate.

**Tech Stack:** Node 24, pnpm 10.32.1, TypeScript 7.0.2, zod 4.5.4, vitest 4.1.11, commander, dotenv 17.4.2. Executor keeps its own pins (Playwright 1.62.1, @e2b/desktop 2.4.0, tsx 4.20.6).

**Spec:** `docs/superpowers/specs/2026-11-06-qa-harness-cli-design.md` (sections 5, 6, 7, 10, 11.1)

## Global Constraints

- Commands: `qa extract`, `qa design`, `qa review`, `qa run`, `qa report`, `qa all`, plus `qa doctor` (spec §4.5).
- Exit codes: `0` all Pass/NotApplicable; `2` invalid config or Runbook; `3` external service failure; `10` any ProductFail; `20` no ProductFail but Blocked/Inconclusive/Automation failure/not_automated. Lower number wins when several apply (spec §7).
- Non-interactive: never prompt; missing input exits non-zero with the reason (spec §7).
- Every command runs the doctor check first; config errors fail at step 0 (spec §2 goal 3).
- Secrets (`OPENAI_API_KEY`, `E2B_API_KEY`, `LINEAR_API_KEY`) come only from env or a gitignored `.env.local`; never from the config file, never into run artifacts or logs (spec §6, §2 anti-goal).
- Run directory is `RUN_ROOT/<feature>/runs/<runId>/`; commands do not overwrite existing artifacts without `--force` (spec §5).
- Runbook missing or incomplete means fail, never fall back to defaults (spec §2 anti-goal).
- Required Runbook files: `QA-models/_workflow/qa-environment.md`, `QA-models/hellyeah/core-journeys.md`, `references/case-design.md`, `references/knowledge-sources.md`, `references/verdicts.md` (spec §4.2).
- Module frontmatter fields: `status` (`pilot`|`draft`|`active`), `version`, `last_reviewed`; `pilot`/`draft` modules cannot alone support ProductFail (spec §4.9).
- Executor is copied, not linked; no runtime dependency on `~/.codex/skills/linear-browser-qa` (spec §10).
- Never copy `qa-env/.env.local` or any credential value.

## Review Focus

1. Config file absent or unparsable: exit 2 with the path it looked for, not a stack trace.
2. Module file with missing or malformed frontmatter, or `status` outside the three values: doctor fails and names the file.
3. `.env.local` present but `OPENAI_API_KEY` empty: doctor fails only for commands that need it (`design`, `review`, `extract`, `run` script generation), not for `doctor` itself.
4. Run dir already exists and `--force` not given: exit 2, existing files untouched.
5. A known secret value appearing in text passed to the redactor, including as a substring of a longer line: replaced by a placeholder.

---

### Task 1: Project scaffold and CLI entry

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/cli.ts`, `src/exit-codes.ts`, `tests/exit-codes.test.ts`
- Run once: `git init` (directory is not a git repository)

**Interfaces:**
- Produces: `ExitCode` const (`OK=0, CONFIG=2, EXTERNAL=3, PRODUCT_FAIL=10, INCOMPLETE=20`); `combineExit(codes: number[]): number` returning the lowest non-zero code, or 0 for an empty/all-zero list; `bin` entry `qa` running `src/cli.ts` via tsx.

- [ ] **Step 1: Write failing test `tests/exit-codes.test.ts`** — `combineExit([0,20,10])===10`, `combineExit([20,2,10])===2`, `combineExit([])===0`, `combineExit([0,0])===0`.
- [ ] **Step 2: Run `pnpm vitest run tests/exit-codes.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Create the scaffold** with the pins from Tech Stack, `.gitignore` covering `node_modules`, `.env.local`, `runs/`, `.DS_Store`; implement `src/exit-codes.ts`; `src/cli.ts` registers the seven commands with commander, each printing "not implemented" and exiting 1 for now.
- [ ] **Step 4: Run test.** Expected: PASS. Also `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: scaffold qa CLI and exit codes"`.

### Task 2: Config loader

**Files:**
- Create: `src/config.ts`, `qa-harness.config.json` (example, no secrets), `tests/config.test.ts`

**Interfaces:**
- Consumes: `ExitCode`.
- Produces: `loadConfig(opts: { configPath?: string; cwd: string; env: NodeJS.ProcessEnv }): Config` throwing `ConfigError` (carries `exitCode=2`, message names the path) ; `Config = { runbook: { path: string }; runRoot: string; executor: { root: string }; llm: { model: string; baseUrl: string; maxRetries: number }; design: { maxCases: number }; run: { caseTimeoutMs: number; totalTimeoutMs: number } }`; relative paths resolved against the config file's directory, never `cwd`. `llm.baseUrl` defaults to `https://api.openai.com/v1`. `requireSecrets(config-needs: ('OPENAI_API_KEY'|'E2B_API_KEY'|'LINEAR_API_KEY')[], env): void` throwing `ConfigError` naming each missing key.
- Note: the spec's `executor.scriptsRoot` becomes `executor.root` pointing at this repo's `executor/` (spec §4.3 superseded by §10).

- [ ] **Step 1: Write failing tests** — valid file loads and resolves `runbook.path` relative to the file; missing file → `ConfigError` whose message contains the looked-for path; unknown key `OPENAI_API_KEY` inside the file → `ConfigError` (secrets not allowed in config); changing `cwd` does not change resolved paths (this is the 11-06 incident); `requireSecrets(['OPENAI_API_KEY'], {})` throws naming the key.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement with zod `.strict()` schema** and dotenv loading of a sibling `.env.local` into a copy of env (do not mutate `process.env`). Defaults for `design.maxCases` (12), `run.caseTimeoutMs` (300000), `run.totalTimeoutMs` (3600000), `llm.maxRetries` (2) are implementer's choice per spec §4.12; use these.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: config loader with cwd-independent paths`.

### Task 3: Runbook loader, reference migration, `qa doctor`

**Files:**
- Create: `src/runbook.ts`, `src/doctor.ts`, `tests/runbook.test.ts`, `tests/doctor.test.ts`, `tests/fixtures/runbook-ok/` (minimal valid tree), `tests/fixtures/runbook-bad-status/`
- Copy from `~/.codex/skills/linear-browser-qa` into `runbook/`: `references/{case-design,knowledge-sources,verdicts,intake-routing,pr-driven-intake,goal-driven-intake,case-matrix,coverage-and-accuracy,temporal-risk-cases}.md`, `assets/report.md`
- Modify: `src/cli.ts` (add `doctor`, call it at the start of every command)

**Interfaces:**
- Consumes: `Config`, `ConfigError`, `requireSecrets`.
- Produces: `type ModuleMeta = { id: string; path: string; status: 'pilot'|'draft'|'active'; version: number; lastReviewed: string }`; `loadRunbook(dir: string): Runbook` where `Runbook = { root: string; modules: ModuleMeta[]; text(relPath: string): string }`, throwing `RunbookError` (exit 2) listing every missing required file and every module with invalid frontmatter; `canSupportProductFail(m: ModuleMeta): boolean` true only for `active`; `runDoctor(config: Config, needs: SecretName[]): DoctorReport` with `{ ok: boolean; problems: string[] }`. Under `QA-models/hellyeah/`, a file is a module if it has frontmatter containing `status`; files with no frontmatter (`index.md`, `dashboard-routing.md`) are skipped (decision flagged in Self-Review).

- [ ] **Step 1: Copy the references and `assets/report.md`**; verify the five required files from Global Constraints now exist under `runbook/`.
- [ ] **Step 2: Write failing tests** — `loadRunbook('runbook')` returns 17 module entries (12 `pilot`, 5 `draft`, zero `active`; `core-journeys` is one of the drafts); `canSupportProductFail` false for all of them; `bad-status` fixture throws `RunbookError` naming the file; removing `references/verdicts.md` in a temp copy throws listing that path; `runDoctor` with empty `OPENAI_API_KEY` and `needs=['OPENAI_API_KEY']` reports a problem, with `needs=[]` reports ok.
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement** frontmatter parse with `gray-matter` (add dependency) validated by zod; doctor aggregates config, runbook and secret problems and never throws for the aggregate case.
- [ ] **Step 5: Run `pnpm vitest run` and `pnpm qa doctor --config qa-harness.config.json`.** Expected: tests PASS; doctor prints `ok` and exits 0.
- [ ] **Step 6: Commit** — `feat: runbook loader and qa doctor`.

### Task 4: Contracts, run directory, redaction

**Files:**
- Create: `src/contracts/{acceptance,change-model,env,cases,generators,case-review,result}.ts`, `src/run-dir.ts`, `src/redact.ts`, `tests/contracts.test.ts`, `tests/run-dir.test.ts`, `tests/redact.test.ts`

**Interfaces:**
- Produces zod schemas and inferred types, field names chosen here (spec §8 leaves naming to the implementer), covering every item in spec §5:
  - `Acceptance`: `{ atoms: { id; text; sourceRef; anchor }[] }`
  - `Case`: `{ id; title; generator: 'G1'|...|'G7'; type: 'happy'|'negative'|'edge'; expected: { text; sourceRef; anchor }; preconditions: string[]; risk: string; testability: { state: 'ready'|'Blocked'|'NotApplicable'; reason?: string } }`
  - `CaseReviewEntry`: `{ caseId; verdict: 'keep'|'drop'|'revise'; reason: string }` (reason non-empty)
  - `Verdict` = `'Pass'|'ProductFail'|'Blocked'|'Inconclusive'|'NotApplicable'|'Automation failure'`; `CaseResult`: `{ caseId; verdict: Verdict; generated: boolean; evidenceDir: string; notes?: string }`
- `createRunDir(runRoot: string, feature: string, runId: string, opts: { force: boolean }): string` creating `<runRoot>/<feature>/runs/<runId>/` and throwing `ConfigError` if it exists and `force` is false; `writeArtifact(runDir, name, data)` validates against the schema registered for `name` before writing.
- `makeRedactor(secrets: string[]): (text: string) => string` replacing each non-empty secret value with `[REDACTED]`; ignores values shorter than 8 characters to avoid corrupting ordinary text.

- [ ] **Step 1: Write failing tests** — `CaseReviewEntry` with empty reason rejected; `Case` without `expected.anchor` rejected; `createRunDir` twice without force throws and leaves a marker file intact; with force succeeds; `makeRedactor(['sk-abcdef123456'])('x sk-abcdef123456 y')==='x [REDACTED] y'`; a 3-char secret is not redacted; `writeArtifact(runDir,'cases.json', invalid)` throws before any file exists.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** schemas and helpers as specified.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat: artifact contracts, run dir, redaction`.

### Task 5: Command skeletons wired to doctor and exit codes

**Files:**
- Modify: `src/cli.ts`; Create: `src/commands/{extract,design,review,run,report,all}.ts`, `tests/cli.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `runDoctor`, `createRunDir`, `combineExit`.
- Produces: each command module exports `run(ctx: CommandContext): Promise<number>` where `CommandContext = { config: Config; runbook: Runbook; runDir: string; env: NodeJS.ProcessEnv; force: boolean }`, returning an exit code. In this plan every stage body prints `"<stage> not implemented"` and returns 1, after doctor passes and after verifying its input artifact exists (`design` needs `acceptance.json`, `review` needs `cases.json`, `run` needs `cases.reviewed.json`, `report` needs `results/`), exiting 2 with the missing file named when absent. `qa all` runs the five in order and stops at the first non-zero.

- [ ] **Step 1: Write failing tests** invoking the CLI as a subprocess — `qa design` in an empty run dir exits 2 and stderr names `acceptance.json`; `qa doctor` with a bad runbook path exits 2; `qa extract` with valid config exits 1 with "not implemented"; no command ever reads stdin (run with closed stdin, assert no hang).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run `pnpm vitest run && pnpm tsc --noEmit`.** Expected: PASS, clean.
- [ ] **Step 5: Commit** — `feat: command skeletons gated by doctor and input contracts`.

### Task 6: Migrate the executor (Actions, run gate, specs)

**Files:**
- Create: `executor/` (copy of `~/.codex/skills/linear-browser-qa/hy_ui_autotest`), `scripts/migrate-executor.sh` (records exactly what was copied), `executor/MIGRATION.md` (source path, source git HEAD `a6c5417` plus "working tree had uncommitted changes", copy date, file list), `tests/executor-smoke.test.ts`
- Copy: everything listed in spec §10 "迁移的 Action(代码)" **plus the import closure** below. Exclude: `node_modules`, `playwright-report`, `apps/`, `midscene_run/`, `src/computer-use/`, `src/exploration/`, and every `qa-env/.env.local`.

**Closure finding (conflicts with spec §10 "不迁移"):** `src/loop/state.ts` imports `checker.ts`, `drift-gate.ts`, `human-review.ts`, `omission.ts`, `pr-diff.ts`; `src/tools/action-index.ts` pulls `action-drift.ts`, `action-table.ts`, `silent-drift.ts`; the clerk code pulls `src/clients/clerk.ts`, `src/session/clerk-session.ts`. These are copied as internal dependencies, **not** exposed as `package.json` scripts or CLI commands. `lane-merge.ts` is copied only if the import check below pulls it in. Trimming them out of `state.ts` is a later plan.

**Interfaces:**
- Produces: `executor/package.json` with scripts `typecheck`, `test:unit`, `test:list`, `action:select`, `loop:state`; `executor/src/tools/action-catalog.json` unchanged (191 entries).

- [ ] **Step 1: Write failing `tests/executor-smoke.test.ts`** — catalog has 191 keys; `executor/src/actions/` has 18 files; no file under `executor/` equals `.env.local`; `executor/package.json` has no `computer-use`, `explore:case`, `qa:checker`, `omission:hook`, `human:review` scripts; `executor/MIGRATION.md` records source HEAD.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Write and run `scripts/migrate-executor.sh`**: rsync from the install copy with the exclusions, delete the non-goal `package.json` scripts, then compute the import closure of `executor/src` and `executor/scripts` (a failing `tsc` listing missing modules is the oracle) and copy any missing file from the source until `tsc` is clean. Record every extra file in `MIGRATION.md`.
- [ ] **Step 4: Verify.** In `executor/`: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:list`. Expected: typecheck clean; unit tests pass except tests whose subject file was intentionally not migrated (delete those test files and list them in `MIGRATION.md`); `test:list` lists the release cases. Then from the repo root `pnpm vitest run tests/executor-smoke.test.ts`: PASS.
- [ ] **Step 5: Verify no secrets.** `grep -rIl -E "(sk-[A-Za-z0-9]{20,}|CLERK_SECRET|E2B_API_KEY=[^\s]+)" executor/ runbook/` Expected: no output.
- [ ] **Step 6: Commit** — `feat: migrate executor from linear-browser-qa install copy`.

---

## Self-Review

- **Spec coverage:** §4.5 doctor (T3), §5 contracts and no-overwrite (T4), §6 config and secrets (T2), §7 exit codes and non-interactive (T1, T5), §10 migration (T6, closure conflict noted). Not covered here by design: `extract`, `design`, `review`, `run`, `script`, `report` bodies, the `revise` loop, `--publish`; each is its own plan. The 11.1 naming unification (source IDs, frontmatter, headings, file renames) is paused and not part of this plan; the doctor's module detection (T3) must be re-checked after it lands.
- **Open decision flagged for the user:** `index.md` and `dashboard-routing.md` have no frontmatter, so T3 skips them as non-modules. The naming work was going to add a `type:` field to make that explicit.
- **Type consistency:** `ExitCode`/`combineExit` (T1) used in T5; `Config`/`ConfigError`/`requireSecrets` (T2) used in T3, T5; `Runbook`/`ModuleMeta` (T3) used in T5; `Verdict`/`Case` (T4) are consumed by later plans.
