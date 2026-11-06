import { Sandbox } from "@e2b/desktop";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  actionIndex,
  hasReuseEvent,
  parseReuseLog,
  validateReuseEvent,
  type ReuseEvent,
} from "../src/tools/action-index";
import { actionInvocationSchemaVersion, canonicalInvocationJson, sha256Bytes } from "../src/tools/action-invocation";
import { captureFailureSnapshot, classifyActionFailure, redactSnapshotText, refineFailureWithSnapshot, type ActionFailureClass } from "../src/tools/action-failure";
import {
  actionCodeHash,
  noticeFor,
  readActionHealth,
  resolveQaRoot,
  updateActionHealth,
  type ActionHealthView,
  type HealthNotice,
} from "../src/tools/action-health";
import { checkSilentDrift, invocationHealthKind, type SilentDriftCheck } from "../src/tools/silent-drift";
import { loadActionTable, resolveIntent } from "../src/tools/action-table";
import { connectSharedChrome, selectUniqueTargetPage, targetOrigin } from "../src/tools/e2b-shared-browser";
import { loadQaEnv } from "../src/tools/qa-env";
import {
  InvocationIdentityError,
  finalizeSharedActionEvidence,
  invocationReuseOutcome,
  resolveInvocationCaseId,
  sharedActionExitCode,
  sharedActionNextStep,
} from "../src/tools/shared-action-evidence";

export { sharedActionExitCode };
import {
  assertSharedActionNotDenied,
  sanitizeSharedActionFact,
  sharedActionRow,
  validateSharedAction,
} from "../src/tools/shared-action-policy";

const USAGE = "Usage: e2b:action --sandbox-id <id> --case-dir <case> --origin <app URL> (--action <name> | --intent <table intent>) --reuse-log <path> --run-id <id> [--case-id <id> | --phase setup|cleanup] [--intent-id <id>] [--domain <domain>] [--args-json '[...]'] [--qa-root <QA_ROOT>] [--product-sha <sha>] [--verify-only]";

/**
 * The Action to run: named directly, or found by its intent in the Action
 * table. When both are given they must agree.
 */
export function resolveSharedActionName(action: string | undefined, intent: string | undefined): string | undefined {
  if (intent === undefined) return action;
  const resolved = resolveIntent(loadActionTable(), intent);
  if (!resolved) {
    throw new Error(`No Action in the table has the intent "${intent}"; search with action:select select --intent, or run the step through Computer Use and log the miss`);
  }
  if (action !== undefined && action !== resolved) {
    throw new Error(`--intent "${intent}" resolves to ${resolved}, not ${action}`);
  }
  return resolved;
}

type RecordingState = { sandboxId?: string; stoppedAt?: string };

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      "sandbox-id": { type: "string" },
      "case-dir": { type: "string" },
      origin: { type: "string" },
      action: { type: "string" },
      intent: { type: "string" },
      domain: { type: "string" },
      "args-json": { type: "string" },
      // Removed: accepted only so it can be refused with an explanation instead
      // of a bare "unknown option".
      "side-effect": { type: "string" },
      "reuse-log": { type: "string" },
      "run-id": { type: "string" },
      "case-id": { type: "string" },
      // setup = sign-in / preparation, cleanup = closeout: calls that belong to no Case.
      phase: { type: "string" },
      "intent-id": { type: "string" },
      // Where Action health lives (QA_ROOT/.qa-loop); found from the run when omitted.
      "qa-root": { type: "string" },
      "product-sha": { type: "string" },
      // A drift repair rerun (action:drift verify): updates health but logs no reuse hit.
      "verify-only": { type: "boolean" },
    },
    strict: true,
  });
  const productSha = values["product-sha"] ?? null;
  if (productSha !== null && !/^[0-9a-f]{7,40}$/i.test(productSha)) {
    throw new Error("--product-sha must be a 7 to 40 character hex commit SHA");
  }
  // Refused rather than ignored: a caller still passing a level believes it
  // matters, and silently dropping it would hide that it no longer does.
  if (values["side-effect"] !== undefined) {
    throw new Error("--side-effect was removed: the rollback level (read | reversible | irreversible) of every Action is written in the Action table, src/tools/action-catalog.json, and e2b:action reads it from there. Drop the flag.");
  }
  const sandboxId = values["sandbox-id"];
  const caseDir = values["case-dir"];
  const actionName = resolveSharedActionName(values.action, values.intent);
  const origin = values.origin ? targetOrigin(values.origin) : null;
  if (!sandboxId || !/^[a-z0-9]+$/.test(sandboxId) || !caseDir || !actionName || !origin ||
      !values["reuse-log"] || !values["run-id"]) {
    throw new Error(USAGE);
  }
  // Shared execution is default-allow; a denied Action is refused here, before
  // the run, the recording or E2B is touched, with the reason and the alternative.
  assertSharedActionNotDenied(actionName);
  // The rollback level, undo Action and intent come from the table row, which
  // every library Action has (action-table.test.ts keeps it so).
  const row = sharedActionRow(actionName);
  const rollback = row.rollback;
  const undoneBy = row.rollback === "reversible" ? row.undoneBy ?? null : null;
  const caseId = resolveInvocationCaseId({ caseDir, caseId: values["case-id"], phase: values.phase });
  const intentId = values["intent-id"] ?? actionName;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(intentId)) {
    throw new Error("--intent-id must be a short identifier");
  }
  const run = parseReuseLog(await readFile(values["reuse-log"], "utf8"));
  if (run.preflight.runId !== values["run-id"]) {
    throw new Error("Action reuse preflight belongs to another run");
  }
  const args: unknown = JSON.parse(values["args-json"] ?? "[]");
  if (!Array.isArray(args)) throw new Error("--args-json must contain an array");
  const recording = JSON.parse(await readFile(
    path.resolve(caseDir, "computer-use/recording.json"), "utf8"
  )) as RecordingState;
  if (recording.stoppedAt || recording.sandboxId !== sandboxId) {
    throw new Error("An active case recording for this E2B sandbox is required");
  }
  const logDir = path.dirname(path.resolve(values["reuse-log"]));
  const resolvedCaseDir = path.resolve(caseDir);
  if (!resolvedCaseDir.startsWith(`${path.dirname(logDir)}${path.sep}`)) {
    throw new Error("Action case directory must belong to the Action reuse run");
  }

  const root = path.resolve(import.meta.dirname, "..");
  const runRoot = path.dirname(logDir);
  // QA_ROOT from qa-env/.env.local is part of the shared run-root rule (loop/run-root.ts).
  loadQaEnv(false);
  const qaRoot = resolveQaRoot(runRoot, values["qa-root"]);
  const lookupStart = Date.now();
  const matches = (await actionIndex(root, [])).filter((entry) =>
    entry.name === actionName && (!values.domain || entry.domain === values.domain)
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one indexed Action named ${actionName}, found ${matches.length}`);
  }
  const actionModule = await import(pathToFileURL(path.join(root, matches[0].file)).href) as
    Record<string, unknown>;
  const action = actionModule[actionName];
  if (typeof action !== "function") throw new Error("Indexed Action export is not executable");
  const lookupMs = Date.now() - lookupStart;
  // Health is advisory: read it to warn, never to refuse.
  let codeHash: string | null = null;
  let healthBefore: HealthNotice = { status: "unknown", notice: null, codeChangedSinceFailure: false };
  try {
    codeHash = actionCodeHash(root, matches[0].file);
    if (qaRoot) {
      const view: ActionHealthView = { status: await readActionHealth(qaRoot), codeHashes: { [matches[0].file]: codeHash } };
      healthBefore = noticeFor(view, matches[0]);
    }
  } catch {
    // An unreadable health file must not stop the Action.
  }

  // qa-env first when present: removeAdminMember checks its target against the
  // shared QA accounts registered there, and refuses when it cannot. A row with
  // a fixed argument count is held to it; any other Action takes at most its
  // formal parameters minus page.
  loadQaEnv(false);
  validateSharedAction(actionName, args, action as (...params: never[]) => unknown);
  loadQaEnv(true);
  const desktop = await Sandbox.connect(sandboxId);
  const browser = await connectSharedChrome(desktop);
  try {
    const page = selectUniqueTargetPage(browser, origin);
    await page.bringToFront();
    process.env.E2E_SHARED_BROWSER_ORIGIN = origin;
    const factDir = path.resolve(caseDir, "playwright", "actions");
    await mkdir(factDir, { recursive: true });
    const id = randomUUID();
    const before = path.join(factDir, `${id}-before.png`);
    const after = path.join(factDir, `${id}-after.png`);
    const factPath = path.join(factDir, `${id}.json`);
    await writeFile(before, await desktop.screenshot(), { mode: 0o600 });
    const startedAt = new Date().toISOString();
    const executionStart = Date.now();
    let fact: unknown = null;
    let error: string | null = null;
    let actionFailed = false;
    try {
      fact = await (action as (page: Page, ...params: unknown[]) => Promise<unknown>)(page, ...args);
      if (rollback === "read" && new URL(page.url()).origin !== origin) {
        throw new Error("Read-only Action left the expected app origin");
      }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      actionFailed = true;
    }
    const executionMs = Date.now() - executionStart;
    // Failure evidence for drift diagnosis, captured from the live page before
    // anything else moves it: classification, locator, timeout and a redacted
    // accessibility snapshot of the failing page.
    let failure: ActionFailureClass | null = null;
    let failureSnapshotPath: string | null = null;
    if (actionFailed && error !== null) {
      failure = classifyActionFailure(error);
      failureSnapshotPath = path.join(factDir, `${id}-failure.json`);
      const snapshot = await captureFailureSnapshot(page);
      // A named control absent from the failure page is drift even when the error reads like an assertion.
      failure = refineFailureWithSnapshot(failure, error, snapshot.ariaSnapshot);
      await writeFile(failureSnapshotPath, `${JSON.stringify({
        kind: "action-failure-evidence", schemaVersion: 1, invocationId: id, action: actionName,
        ...failure, error: redactSnapshotText(error, 4_000), snapshot,
      }, null, 2)}\n`, { mode: 0o600 });
    }
    const evidence = await finalizeSharedActionEvidence(rollback, error,
      async () => writeFile(after, await desktop.screenshot(), { mode: 0o600 }));
    const { status } = evidence;
    const finishedAt = new Date().toISOString();
    const invocationId = id;
    const factBody = {
      kind: "action-invocation" as const,
      schemaVersion: actionInvocationSchemaVersion,
      invocationId,
      runId: values["run-id"]!,
      caseId,
      intentId,
      action: actionName,
      domain: matches[0].domain,
      sandboxId,
      origin,
      rollback,
      undoneBy,
      intent: row.intent,
      status,
      startedAt,
      finishedAt,
      lookupMs,
      executionMs,
      factPath: path.relative(caseDir, factPath).replaceAll(path.sep, "/"),
      beforeScreenshot: path.basename(before),
      afterScreenshot: evidence.afterCaptured ? path.basename(after) : null,
      target: {
        origin,
        beforeScreenshot: path.relative(caseDir, before).replaceAll(path.sep, "/"),
        afterScreenshot: evidence.afterCaptured ? path.relative(caseDir, after).replaceAll(path.sep, "/") : null,
      },
      fact: sanitizeSharedActionFact(fact),
      error: evidence.error,
      driftSuspected: failure?.driftSuspected ?? false,
      failure,
      failureSnapshot: failureSnapshotPath ? path.relative(caseDir, failureSnapshotPath).replaceAll(path.sep, "/") : null,
    };
    const invocationFact = {
      ...factBody,
      integrityHash: sha256Bytes(canonicalInvocationJson(factBody)),
    };
    const factBytes = Buffer.from(JSON.stringify(invocationFact, null, 2) + "\n");
    await writeFile(factPath, factBytes, { mode: 0o600 });
    const factRef = path.relative(logDir, factPath).replaceAll(path.sep, "/");
    const factSha256 = sha256Bytes(factBytes);
    // Silent drift: a read that completed but whose reading breaks the row's
    // expectations (all empty, a mustHaveValue field empty, an enumerated value
    // outside allowedValues) is not trusted as evidence until a Computer Use
    // screenshot confirms it.
    const silentDrift: SilentDriftCheck = status === "completed" && rollback === "read"
      ? checkSilentDrift(fact, { mustHaveValue: row.mustHaveValue, allowedValues: row.allowedValues, driftSentinels: row.driftSentinels })
      : { crossCheck: false, reasons: [] };
    // Reusing an Action is the hit side of action_reuse_rate, and it is written
    // here for the same reason computer-use act writes its miss: a number that
    // depends on someone remembering a second command is a number that stays
    // empty. Only a clean, trusted run counts as a hit — a failed or unknown
    // invocation did not demonstrate the Action is reusable, and a suspicious
    // reading is logged as pending_crosscheck until `action:reuse confirm`.
    let reuseEvent: ReuseEvent | null = null;
    const outcome = invocationReuseOutcome({ status, verifyOnly: values["verify-only"] === true, crossCheck: silentDrift.crossCheck });
    if (outcome) {
      reuseEvent = validateReuseEvent({
        runId: values["run-id"]!,
        caseId,
        intentId,
        intent: row.intent,
        outcome,
        ...(outcome === "pending_crosscheck" ? { crossCheckReasons: silentDrift.reasons } : {}),
        source: matches[0].hot ? "hot" : "index",
        action: actionName,
        invocationId,
        factRef,
        factSha256,
        lookupMs,
        executionMs,
      });
      if (!hasReuseEvent(run.events, values["run-id"]!, caseId, intentId)) {
        await appendFile(values["reuse-log"]!, `${JSON.stringify(reuseEvent)}\n`, { flag: "a" });
      } else {
        reuseEvent = null;
      }
    }
    // Cross-run health: a clean, trusted run verifies the Action at this code and
    // deployment; a drift-suspected failure counts against it. A reading waiting
    // for its cross-check changes nothing until `action:reuse confirm` (drift marks it).
    // Other failures (network, business assertion, closed browser) say nothing about drift.
    let health: unknown = null;
    let healthError: string | null = null;
    if (qaRoot && codeHash) {
      const stamp = { at: finishedAt, runId: values["run-id"]!, environment: new URL(origin).host, productSha, codeHash };
      try {
        // A drift sentinel (the Action said it did not recognize the page) marks suspected_drift at once.
        const healthKind = invocationHealthKind({ status, driftSuspected: failure?.driftSuspected ?? false, silentDrift });
        health = healthKind === "completed"
          ? await updateActionHealth(qaRoot, { action: actionName, kind: "completed", stamp })
          : healthKind === "drift" || healthKind === "sentinel_drift"
            ? await updateActionHealth(qaRoot, { action: actionName, kind: "drift", stamp, failure: {
                category: healthKind === "sentinel_drift" ? "sentinel_drift" : failure!.category,
                locator: healthKind === "sentinel_drift" ? null : failure!.locator,
                evidenceRef: path.relative(qaRoot, (healthKind === "drift" ? failureSnapshotPath : null) ?? factPath).replaceAll(path.sep, "/"),
              } })
            : null;
      } catch (healthFailure) {
        healthError = healthFailure instanceof Error ? healthFailure.message : String(healthFailure);
      }
    }
    const driftSuspected = failure?.driftSuspected ?? false;
    console.log(JSON.stringify({ action: actionName, intent: row.intent, rollback, undoneBy, status,
      driftSuspected, failure,
      crossCheck: silentDrift.crossCheck ? {
        reasons: silentDrift.reasons,
        nextStep: `读数可疑（可能静默失效），已记为 pending_crosscheck、未计命中：先用 computer-use 截图核对这些读数，再落定：` +
          `pnpm action:reuse confirm --log ${values["reuse-log"]} --run-id ${values["run-id"]} --case-id ${caseId} ` +
          `--intent-id ${intentId} --result hit|drift [--evidence <截图>]。属实记 hit 后读数可当判定依据；不属实记 drift ` +
          `（健康标为 suspected_drift），用 computer-use 重做该意图，收尾 action:drift list / verify ${actionName}`,
      } : null,
      nextStep: sharedActionNextStep(status, rollback, undoneBy, driftSuspected ? actionName : null), lookupMs, executionMs,
      invocationId, caseId, intentId, factPath, factRef, reuseEvent,
      factSha256, failureSnapshot: failureSnapshotPath,
      healthBefore: healthBefore.notice ? healthBefore : null, health, healthError,
      qaRoot, verifyOnly: values["verify-only"] === true }));
    process.exitCode = sharedActionExitCode(status);
  } finally {
    await browser.close();
    delete process.env.E2E_SHARED_BROWSER_ORIGIN;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    // An illegal Case identity is answered in JSON, like every result of this command.
    if (error instanceof InvocationIdentityError) console.log(JSON.stringify(error.toJSON()));
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
