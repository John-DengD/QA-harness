# `qa design`, `qa review` and the `qa all` revise loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `qa design` turns `acceptance.json` into `cases.json` + `generators.json` via the seven generators; `qa review` has an independent LLM reviewer judge each case (code drops un-anchored cases first); `qa all` runs the design↔review loop with at most two revisions.

**Architecture:** Same pattern as `qa extract`: the LLM proposes, code verifies (anchors, ids, budget, completeness). Both stages take an injected `LlmTransport`. Source texts are persisted by `extract` as `sources.json` so later stages can verify anchors.

**Tech Stack:** unchanged (zod, vitest, injected transport).

**Spec:** `docs/superpowers/specs/2026-11-06-qa-harness-cli-design.md` §4.11–4.12, §5 (design, review), §12. Runbook: `runbook/references/case-design.md`, `coverage-and-accuracy.md`.

## Global Constraints

- All seven generators G1–G7 must conclude: mechanisms produced, or `not_applicable` plus a reason (spec §5). A response missing one is invalid and retried by `callStructured`.
- A case needs `expected.sourceRef` (a ref present in `sources.json`) and `expected.anchor` verbatim in that source (`anchorInSource`). A case failing this is **not** planned: code moves it to `generators.json.candidatePool` with the reason (spec §5 "没有权威出处的机制不进计划").
- Budget (spec §4.12): G1 cases are always kept; the others are kept in the LLM's priority order until total = `design.maxCases` (never below the G1 count). Code trims the rest and records each in `generators.json.trimmed` with reason `over budget`.
- Case ids are assigned by code: `C01`, `C02`, … ; ids never change across revisions (spec §4.11).
- Revision: `qa design --revise` regenerates **only** cases the latest review marked `revise`, keeping ids; each round saves `cases.v1.json`, `cases.v2.json`, …; `cases.json` always holds the latest. At most **2** revisions; a case still `revise` after that becomes `drop` with reason `revise limit reached` (spec §4.5/4.11).
- Review: independent call, different prompt, input is only `cases.json`, `acceptance.json`, `sources.json` and Runbook text; never design's output reasoning (spec §5). Code drops (no model) any case whose anchor is absent from its source. Every case gets exactly one entry with a non-empty reason; `drop` and `revise` reasons are persisted in `case-review.json`.
- `qa review` writes `case-review.json` (and `case-review.vN.json` per round) and `cases.reviewed.json` (keeps only; ids and fields unchanged).
- The LLM never reads files or env; no secret in prompts or artifacts. Exit codes: invalid input 2, external 3.
- Overwriting: first writes refuse existing files without `--force` (foundation contract); the revise path overwrites `cases.json` and `cases.reviewed.json` by design and says so in its tests.

## Review Focus

1. A case citing an unknown sourceRef or a paraphrased anchor never reaches `cases.json`; it appears in `candidatePool` with the reason.
2. The LLM returns more cases than the budget, with G1 cases last: G1 cases still all survive; the cut falls on the others.
3. The reviewer omits a case id or returns an unknown one: invalid, retried, then exit 3.
4. After two revisions a case is still `revise`: it ends as `drop` with the limit reason, and `qa all` terminates.
5. `--revise` changes only the cases marked `revise`; every other case is byte-identical and ids are preserved.

---

### Task 0: `extract` persists the source texts

**Files:** Modify `src/contracts/` (add `sources.ts`: `SourcesFile = { sources: { ref; title; text }[] }`), `src/run-dir.ts` (register `sources.json`), `src/commands/extract.ts`, `tests/extract-command.test.ts`

- [ ] **Step 1: Write failing test** — after a successful `--ticket-file` extract, `sources.json` exists and its text contains the ticket text; it is also written when no atom survives.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** (write it with `extract-report.json`). **Step 4: Run, expect PASS.** **Step 5: Commit** — `feat: extract persists source texts`.

### Task 1: `qa design`

**Files:** Create `src/design/prompts.ts`, `src/design/design.ts`, `tests/design.test.ts`; modify `src/commands/design.ts`, `src/contracts/cases.ts` (add `CaseDraft` = `Case` without `id`), `src/contracts/generators.ts` if fields are missing.

**Interfaces:**
- Produces: `designCases(opts: { transport; runbook; acceptance: Acceptance; changeModel: ChangeModel | null; sources: SourceDoc[]; maxCases: number; maxRetries: number }): Promise<{ cases: Case[]; generators: GeneratorsFile }>`; `reviseCases(opts: { transport; runbook; cases: Case[]; feedback: { caseId: string; reason: string }[]; sources: SourceDoc[]; acceptance; maxRetries }): Promise<Case[]>` (returns only the revised cases, same ids; code verifies the id set equals the requested set, otherwise invalid); `runDesign(ctx: CommandContext, deps: { transport }): Promise<number>` (`ctx.args.revise` selects revise mode).
- LLM output schema (design): `{ generators: {generator: G1..G7; conclusion; mechanisms[]; reason?}[]; cases: CaseDraft[] (priority order); candidatePool: {mechanism; why}[] }` with a superRefine requiring all seven generators exactly once and a reason when `not_applicable`.
- The system prompt contains `references/case-design.md` and `references/coverage-and-accuracy.md` text verbatim and the rules "expected.anchor must be copied from the source exactly" and the budget number.

- [ ] **Step 1: Write failing tests** with a fake transport — valid output → `cases.json` ids `C01…`, `cases.v1.json` equal to it, `generators.json` with all seven; missing generator G5 in the output → retried then exit 3 (maxRetries 0); case with unknown sourceRef or paraphrased anchor → moved to `candidatePool` with reason, not in cases (Review Focus 1); budget: 6 cases (2 G1 last) with `maxCases: 3` → both G1 kept plus the first non-G1, the rest in `trimmed` with `over budget` (Review Focus 2); revise mode: reviewer feedback for `C02` → only `C02` changes, other cases identical, ids unchanged, `cases.v2.json` written and `cases.json` updated (Review Focus 5); revise returning a different id set → invalid; missing `acceptance.json` already exits 2 via the stage input check.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** design and revise functions and `runDesign`; replace the stub `designStage.run`. **Step 4: Run, expect PASS.** **Step 5: Commit** — `feat: qa design with seven generators and revise mode`.

### Task 2: `qa review`

**Files:** Create `src/review/prompts.ts`, `src/review/review.ts`, `tests/review.test.ts`; modify `src/commands/review.ts`.

**Interfaces:**
- Produces: `reviewCases(opts: { transport; runbook; cases: Case[]; acceptance; sources: SourceDoc[]; maxRetries; round: number; maxRevisions: number }): Promise<{ entries: CaseReviewEntry[]; reviewed: Case[] }>`.
  - Code pass first: case whose anchor is not found in its source → entry `{verdict: "drop", reason: "anchor not found in source (checked by code)"}`; these cases are not sent to the model.
  - The model returns one entry per remaining case id (schema built with the id list; missing, extra or duplicate ids → invalid).
  - When `round > maxRevisions` (a third review), any `revise` is converted to `drop` with reason `revise limit reached`.
  - `reviewed` = cases with verdict `keep`, unchanged.
- `runReview(ctx, deps): Promise<number>`: round = number of existing `case-review.v*.json` + 1; writes `case-review.vN.json` and `case-review.json` (latest) and `cases.reviewed.json`; prints counts; exit 0 (pending revisions are reported in the output, not as a failure).
- Reviewer prompt: independent role, the Runbook's `case-design.md` rules, the criteria "duplicate failure mechanism, out of ticket/PR scope, precondition not satisfiable in the environment, side effect not authorised", and the rule that `drop` and `revise` need a concrete reason.

- [ ] **Step 1: Write failing tests** — mixed verdicts written to `case-review.json` with reasons and `cases.reviewed.json` containing only keeps; un-anchored case dropped by code and absent from the prompt captured by the fake transport; omitted/unknown id → invalid, exit 3 (Review Focus 3); round 3 turns `revise` into `drop` (Review Focus 4); prompt does not contain any design-stage reasoning (the test asserts it contains only the case JSON, acceptance and runbook text); empty reason from the model → invalid.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.** **Step 5: Commit** — `feat: qa review with independent reviewer`.

### Task 3: `qa all` with the revise loop

**Files:** Create `src/commands/review-loop.ts`, `tests/review-loop.test.ts`; modify `src/commands/index.ts` (`ALL_STAGES`), `src/cli.ts`.

**Interfaces:**
- Produces: `reviewLoopStage: Stage` (name `review`) whose `run` does review, then while the latest `case-review.json` has `revise` entries and fewer than 2 revisions were made: design in revise mode, review again; returns the last review's exit code. `ALL_STAGES = [extractStage, designStage, reviewLoopStage, runStage, reportStage]`; `qa all` uses `ALL_STAGES`, single commands keep using their own stage.

- [ ] **Step 1: Write failing tests** with fake transports: reviewer says `revise` for C02 then `keep` → loop ends after one revision, `cases.v2.json` exists; reviewer always `revise` → exactly two revisions, third review turns it into `drop`, loop terminates (Review Focus 4); no `revise` → no design call.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run `pnpm test && pnpm tsc --noEmit`.** Expected: PASS, clean. **Step 5: Commit** — `feat: qa all runs the review/revise loop`.

---

## Self-Review

- **Spec coverage:** §5 design/review outputs and independence, §4.11 revise loop and version files, §4.12 budget, §12 boundaries (code enforces anchors, budget, completeness, id integrity; LLM does semantics). Not covered: executing cases (run plan), reports.
- **Consistency:** `Case`, `CaseReviewEntry`, `GeneratorsFile` from the foundation contracts; `SourceDoc` from the extract plan; `sources.json` is a new artifact (Task 0) because spec §5 requires checking anchors against the original text in two later stages.
- **Open decisions made here:** reviews run up to three times (two revisions); `qa review` exits 0 even with pending `revise` (the loop belongs to `qa all`); the budget cut follows the LLM's own priority order.
