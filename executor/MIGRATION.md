# Executor migration record

- Source: `/Users/new/.codex/skills/linear-browser-qa/hy_ui_autotest` (a git checkout)
- Source HEAD: a6c5417 — the working tree had 39 uncommitted changes when copied; the copy includes them (they are the newest content)
- Copied by: `scripts/migrate-executor.sh` (re-running overwrites `executor/`)

## Not copied
`node_modules`, `playwright-report`, `apps/` (report app), `midscene_run/`, `src/computer-use/`, `src/exploration/`, `pnpm-workspace.yaml`, every `.env*` file (credentials stay out of this repo).

## Removed after copy (non-goals, spec §2)
- Scripts: e2b-computer-use, explore-case, human-review, omission-hook, qa-checker, pr-diff-inventory, autoloop-brief, autoloop-events, autoloop-weekly-digest, bundle-agent-qa-report.mjs
- package.json scripts: computer-use, explore:case, qa:checker, omission:hook, human:review, pr:diff-inventory, report:*, check
- Unit tests of those removed scripts: qa-checker-case qa-checker agent-qa-report human-review omission-hook lane-merge pr-diff-inventory computer-use-miss-cli
- Dead code and its tests (nothing imported it but its own test): src/loop/lane-merge.ts src/tools/computer-use-contract.ts src/tools/computer-use-recording.ts src/tools/jev-exploration.ts src/tools/schedule.ts

## Kept although the spec said "do not migrate" (import closure)
`src/loop/{checker,drift-gate,human-review,omission,pr-diff}.ts` are imported by `src/loop/state.ts`; `src/tools/{action-drift,action-table,silent-drift}.ts` by the Action index; `src/clients/clerk.ts`, `src/session/clerk-session.ts` by the Clerk login code. They are not exposed as scripts. Trimming them out of `state.ts` is future work.

## Kept beyond the spec (not required by the import closure)
Spec §10 names only `run-e2b-playwright`, `e2b-action`, `action-select` as scripts to migrate. These additional scripts were copied and are still exposed in `package.json`; they are Action-maintenance and release tooling, not needed by the five `qa` commands, and are candidates for trimming: action-reuse, action-drift, action-heal, action-prune, check-install-mode, check-qa-env, qa-env-root, qa-init, healthcheck, release-gate, validate-dispatch, validate-env, spec-assert-lock, verify-shared-e2b.

## Runner cwd
`scripts/run-e2b-playwright.ts` originally spawned Playwright with `cwd: process.cwd()`; it is now pinned to the executor directory. Other `process.cwd()` uses in the executor only build display paths.

## Credentials
The executor reads credentials from `<repo root>/qa-env/.env.local` (path fixed in `src/tools/qa-env.ts`, gitignored) or from the process environment, which wins. `pnpm test:list` and Playwright need those variables at config load, so without them it reports `Total: 0 tests`; with placeholder values (including a known staging hostname for E2E_BASE_URL and a 32-character admin token) it lists the same 44 tests in 20 files as the source copy.

## Local change
`playwright.config.ts` imported `./apps/report/src/runtime-metadata`; that helper is copied to `src/report/runtime-metadata.ts` and the import repointed.
