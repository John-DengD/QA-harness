import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Case } from "../contracts/cases";
import type { Env } from "../contracts/env";
import type { CaseResult } from "../contracts/result";
import type { RunSummary } from "../contracts/run-summary";
import type { LlmTransport } from "../llm/structured";
import { makeRedactor } from "../redact";
import type { Runbook } from "../runbook";
import { writeArtifact } from "../run-dir";
import { generateScript } from "./generate";
import { findExistingScript, gateSideEffects, loadAuthorizedSideEffects, loadBindings } from "./scripts";
import type { RunDeps } from "./types";
import { classifyPlaywrightReport, expectedSourceKind, mapVerdict, summaryExitCode } from "./verdict";

export async function runCases(opts: {
  cases: Case[];
  env: Env;
  runbook: Runbook;
  runDir: string;
  runId: string;
  feature: string;
  secrets: string[];
  force: boolean;
  deps: RunDeps;
  transport: LlmTransport;
  limits: { caseTimeoutMs: number; totalTimeoutMs: number; maxRetries: number };
  now?: () => number;
}): Promise<{ results: CaseResult[]; summary: RunSummary; exitCode: number }> {
  const now = opts.now ?? Date.now;
  const started = now();
  const redact = makeRedactor(opts.secrets);
  const bindings = loadBindings(opts.runbook);
  const authorized = loadAuthorizedSideEffects(opts.runbook);
  const { deps } = opts;

  const results: CaseResult[] = [];
  const summary: RunSummary = { executed: [], notAutomated: [], skipped: [], blocked: [], startedAt: new Date(started).toISOString(), finishedAt: "" };
  let registered = false;

  const save = (r: CaseResult) => {
    const clean: CaseResult = { ...r, ...(r.notes ? { notes: redact(r.notes) } : {}) };
    writeArtifact(opts.runDir, `results/${r.caseId}.json`, clean, { force: opts.force });
    results.push(clean);
  };

  for (const c of opts.cases) {
    if (c.testability.state !== "ready") {
      const verdict = c.testability.state === "Blocked" ? "Blocked" : "NotApplicable";
      if (verdict === "Blocked") summary.blocked.push({ caseId: c.id, reason: c.testability.reason ?? "" });
      save({ caseId: c.id, verdict, generated: false, evidenceDir: "", notes: c.testability.reason });
      continue;
    }
    if (now() - started >= opts.limits.totalTimeoutMs) {
      summary.skipped.push({ caseId: c.id, reason: "total time limit reached before this case started" });
      continue;
    }
    if (!registered) {
      await deps.registry.register({ runDir: opts.runDir, runId: opts.runId, feature: opts.feature, env: opts.env, taskModelRef: "cases.reviewed.json" });
      registered = true;
    }

    const caseDir = path.join(opts.runDir, "evidence", c.id);
    mkdirSync(caseDir, { recursive: true });
    const evidenceDir = path.relative(opts.runDir, caseDir);
    let sandboxId: string | null = null;
    try {
      sandboxId = (await deps.sandbox.create({ url: opts.env.baseUrl })).sandboxId;

      let spec: string;
      let grep: string | undefined;
      let generated = false;
      const existing = findExistingScript(c, bindings);
      if (existing) {
        spec = existing.spec;
        grep = existing.grep;
      } else {
        const dom = await deps.sandbox.snapshot(sandboxId, opts.env.baseUrl);
        const gen = await generateScript({
          transport: opts.transport, case: c, domSnapshot: dom, baseUrl: opts.env.baseUrl, validate: deps.validate, maxRetries: opts.limits.maxRetries,
          writeSpec: async (code) => {
            const dir = path.join(opts.runDir, "generated-specs");
            mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${c.id}.spec.ts`);
            writeFileSync(file, code);
            return file;
          },
        });
        if (!gen.ok) {
          summary.notAutomated.push({ caseId: c.id, reason: gen.reason });
          continue;
        }
        const gate = gateSideEffects(gen.sideEffects, authorized);
        if (!gate.ok) {
          const reason = `generated script declares side effects that are not authorised: ${gate.unauthorized.join(", ")}`;
          summary.blocked.push({ caseId: c.id, reason });
          save({ caseId: c.id, verdict: "Blocked", generated: true, evidenceDir, notes: reason });
          continue;
        }
        spec = gen.specPath;
        generated = true;
      }

      summary.executed.push(c.id);
      let recordingOk = false;
      let recordingNote: string | undefined;
      let started_ = false;
      let pw: Awaited<ReturnType<typeof deps.playwright.run>> | null = null;
      let pwError: string | undefined;
      try {
        await deps.sandbox.startRecording(sandboxId, caseDir);
        started_ = true;
        pw = await deps.playwright.run({ sandboxId, specPath: spec, grep, outputDir: path.join(caseDir, "test-results"), timeoutMs: opts.limits.caseTimeoutMs });
      } catch (e) {
        pwError = (e as Error).message;
      } finally {
        if (started_) {
          try {
            const rec = await deps.sandbox.stopRecording(sandboxId, caseDir);
            recordingOk = rec.bytes > 0;
            if (!recordingOk) recordingNote = "the recording is empty";
          } catch (e) {
            recordingNote = `could not finalise the recording: ${(e as Error).message}`;
          }
        } else {
          recordingNote = `the recording could not start: ${pwError ?? "unknown"}`;
        }
      }

      if (pw) {
        writeFileSync(path.join(caseDir, "playwright.stdout.txt"), redact(pw.stdout));
        writeFileSync(path.join(caseDir, "playwright.stderr.txt"), redact(pw.stderr));
      }
      const classification = pw
        ? classifyPlaywrightReport(pw.reportJson, pw.exitCode, pw.timedOut)
        : ({ outcome: "failed", kind: "automation", message: `the script could not be run: ${pwError ?? "unknown error"}` } as const);
      const mapped = mapVerdict({
        classification,
        sourceKind: expectedSourceKind(c.expected.sourceRef, opts.runbook),
        generated,
        recordingOk,
      });
      const notes = [mapped.notes, recordingNote].filter(Boolean).join(" | ") || undefined;
      save({ caseId: c.id, verdict: mapped.verdict, generated, evidenceDir, ...(notes ? { notes } : {}) });
    } catch (e) {
      summary.executed.includes(c.id) || summary.executed.push(c.id);
      save({ caseId: c.id, verdict: "Automation failure", generated: false, evidenceDir, notes: `sandbox or setup failed: ${(e as Error).message}` });
    } finally {
      if (sandboxId) await deps.sandbox.kill(sandboxId).catch(() => undefined);
    }
  }

  summary.finishedAt = new Date(now()).toISOString();
  return { results, summary, exitCode: summaryExitCode(results, { notAutomated: summary.notAutomated.length, skipped: summary.skipped.length }) };
}
