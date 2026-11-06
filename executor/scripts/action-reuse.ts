import { appendFile, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  actionIndex, findActions, parseReuseLog, summarizeReuse, validateCrossCheckResolution, validateReuseEvent,
  type CrossCheckResolution, type ReusePreflight,
} from "../src/tools/action-index";
import { reportDriftForEvent } from "../src/tools/action-drift";
import { loadQaEnv } from "../src/tools/qa-env";
import { readActionInvocationFact } from "../src/tools/action-invocation";
import { loadActionCatalog } from "../src/tools/action-select";
import { prepareReuseMiss } from "../src/tools/reuse-miss";
import { actionCodeHashes, readActionHealth, resolveQaRoot } from "../src/tools/action-health";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { positionals, values } = parseArgs({
    args, allowPositionals: true,
    options: {
      query: { type: "string" }, domain: { type: "string" },
      log: { type: "string" }, event: { type: "string" },
      "run-id": { type: "string" },
      "case-id": { type: "string" }, "intent-id": { type: "string" },
      result: { type: "string" }, evidence: { type: "string" },
      all: { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (!["list", "search", "preflight", "record", "confirm", "summary"].includes(command ?? "") || positionals.length !== 1) {
    throw new Error([
      "Usage: action:reuse <list|search|preflight|record|confirm|summary> [--query ... --domain ... --log ... --run-id ... --event ...]",
      "  confirm --log LOG --run-id ID --case-id CASE --intent-id INTENT --result hit|drift [--evidence RUN_ROOT-relative screenshot]",
      "          settles a pending_crosscheck written by e2b:action after comparing the reading with a screenshot",
    ].join("\n"));
  }
  // QA_ROOT from qa-env/.env.local feeds the shared run-root rule for Action health.
  loadQaEnv();
  if (command === "list" || command === "search") {
    const root = path.resolve(import.meta.dirname, "..");
    const { actions } = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
    const entries = await actionIndex(root, actions);
    const matches = command === "search"
      ? findActions(entries, values.query ?? "", values.domain)
      : entries.filter((entry) => (values.all || entry.hot) && (!values.domain || entry.domain === values.domain));
    const shown = values.all ? matches : matches.slice(0, command === "search" ? 12 : undefined);
    console.log(JSON.stringify({
      indexed: entries.length, matched: matches.length,
      truncated: shown.length < matches.length, matches: shown,
    }, null, 2));
    return;
  }
  if (!values.log) throw new Error("--log is required");
  const readRun = async () => {
    let contents: string;
    try {
      contents = await readFile(values.log!, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Action reuse log is missing: run preflight before testing; metrics are unmeasured");
      }
      throw error;
    }
    return parseReuseLog(contents);
  };
  const verifyHit = async (event: ReturnType<typeof validateReuseEvent>, checkCurrentIndex: boolean) => {
    if (event.outcome !== "hit") return;
    if (checkCurrentIndex) {
      const root = path.resolve(import.meta.dirname, "..");
      const { actions } = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
      const entry = (await actionIndex(root, actions)).find((candidate) => candidate.name === event.action);
      if (!entry || (event.source === "hot") !== entry.hot) {
        throw new Error("Hit Action or hot/index source does not match the current code");
      }
    }
    const factPath = path.isAbsolute(event.factRef!)
      ? event.factRef!
      : path.resolve(path.dirname(values.log!), event.factRef!);
    const runRoot = await realpath(path.resolve(path.dirname(values.log!), ".."));
    const factRealPath = await realpath(factPath);
    if (!factRealPath.startsWith(`${runRoot}${path.sep}`) ||
        !factRealPath.includes(`${path.sep}playwright${path.sep}actions${path.sep}`) ||
        (await lstat(factPath)).isSymbolicLink()) {
      throw new Error("Hit invocation fact must be a regular Action fact in the current run");
    }
    await readActionInvocationFact(factPath, {
      runId: event.runId,
      caseId: event.caseId,
      intentId: event.intentId,
      action: event.action!,
      invocationId: event.invocationId!,
      factRef: event.factRef!,
      factSha256: event.factSha256!,
      lookupMs: event.lookupMs,
      executionMs: event.executionMs,
    });
  };
  if (command === "preflight") {
    if (!values["run-id"] || values["run-id"].length > 160) throw new Error("--run-id is required (max 160 characters)");
    const root = path.resolve(import.meta.dirname, "..");
    const { actions } = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
    const entries = await actionIndex(root, actions);
    if (values.domain && !entries.some((entry) => entry.domain === values.domain)) {
      throw new Error(`Unknown Action domain: ${values.domain}`);
    }
    const candidates = entries.filter((entry) => !values.domain || entry.domain === values.domain);
    const preflight: ReusePreflight = {
      kind: "preflight", runId: values["run-id"], createdAt: new Date().toISOString(),
      ...(values.domain ? { domain: values.domain } : {}), indexedActions: candidates.length,
      hotCandidates: candidates.filter((entry) => entry.hot).map((entry) => entry.name),
    };
    await mkdir(path.dirname(values.log), { recursive: true });
    try {
      await writeFile(values.log, `${JSON.stringify(preflight)}\n`, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Action reuse log already exists: keep its history, use another run/log for a new preflight");
      }
      throw error;
    }
    console.log(JSON.stringify(preflight, null, 2));
    return;
  }
  if (command === "record") {
    if (!values.event) throw new Error("--event is required");
    let event = validateReuseEvent(JSON.parse(values.event));
    const run = await readRun();
    if (event.outcome === "miss") {
      // A new miss is held to the same rules as one written by computer-use act:
      // no browser primitives, absent only when the library has no candidate,
      // and reasons that point at an Action must name a real one.
      const root = path.resolve(import.meta.dirname, "..");
      const { actions } = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
      const indexed = await actionIndex(root, actions);
      const healthView = async (entries: typeof indexed) => {
        const qaRoot = resolveQaRoot(path.dirname(path.dirname(path.resolve(values.log!))));
        if (!qaRoot) return undefined;
        try {
          return { status: await readActionHealth(qaRoot), codeHashes: actionCodeHashes(root, entries.map((entry) => entry.file)) };
        } catch {
          return undefined;
        }
      };
      event = prepareReuseMiss({
        runId: event.runId, caseId: event.caseId, intentId: event.intentId, intent: event.intent,
        source: event.source as "computer-use" | "playwright-explore", reason: event.reason,
        action: event.action, reviewedCandidates: event.reviewedCandidates,
        lookupMs: event.lookupMs, executionMs: event.executionMs,
      }, { entries: indexed, catalog: await loadActionCatalog(root), priorEvents: [], health: await healthView(indexed) })!;
    }
    if (event.runId !== run.preflight.runId) throw new Error("Event runId does not match Action reuse preflight");
    if (event.outcome === "pending_crosscheck") throw new Error("pending_crosscheck is written only by e2b:action; settle it with confirm");
    await verifyHit(event, true);
    summarizeReuse([...run.events, event]);
    await appendFile(values.log, `${JSON.stringify(event)}\n`, { flag: "a" });
    // A drift miss with an Action marks that Action suspected_drift (action:drift list picks it up).
    const drift = await reportDriftForEvent({ event, reuseLog: values.log, skillRoot: path.resolve(import.meta.dirname, ".."),
      entries: await actionIndex(path.resolve(import.meta.dirname, ".."), []) });
    console.log(JSON.stringify({ recorded: true, ...(drift.health || drift.healthError ? drift : {}) }));
    return;
  }
  if (command === "confirm") {
    for (const name of ["run-id", "case-id", "intent-id", "result"] as const) {
      if (!values[name]) throw new Error(`confirm needs --${name}`);
    }
    if (values.result !== "hit" && values.result !== "drift") throw new Error("--result must be hit or drift");
    const run = await readRun();
    if (run.preflight.runId !== values["run-id"]) throw new Error("--run-id does not match the Action reuse preflight");
    const current = run.events.find((event) => event.caseId === values["case-id"] && event.intentId === values["intent-id"]);
    if (!current || (current.outcome !== "pending_crosscheck" && !current.crossCheck)) {
      throw new Error(`${values["case-id"]}/${values["intent-id"]} has no pending cross-check in this log`);
    }
    if (current.crossCheck) throw new Error(`${values["case-id"]}/${values["intent-id"]} cross-check is already settled (${current.crossCheck.result})`);
    // The invocation fact must still be the one e2b:action wrote, whatever the verdict.
    await verifyHit({ ...current, outcome: "hit" }, false);
    if (values.evidence) {
      const runRoot = await realpath(path.resolve(path.dirname(values.log), ".."));
      const evidence = await realpath(path.resolve(runRoot, values.evidence)).catch(() => null);
      if (!evidence || !evidence.startsWith(`${runRoot}${path.sep}`)) {
        throw new Error("--evidence must be an existing RUN_ROOT-relative screenshot or fact of this run");
      }
    }
    const resolution: CrossCheckResolution = validateCrossCheckResolution({
      kind: "crosscheck_resolution", runId: values["run-id"], caseId: values["case-id"], intentId: values["intent-id"],
      result: values.result, confirmedAt: new Date().toISOString(), ...(values.evidence ? { evidenceRef: values.evidence } : {}),
    });
    const before = await readFile(values.log, "utf8");
    const next = parseReuseLog(`${before}${JSON.stringify(resolution)}\n`);
    await appendFile(values.log, `${JSON.stringify(resolution)}\n`, { flag: "a" });
    const event = next.events.find((item) => item.caseId === resolution.caseId && item.intentId === resolution.intentId)!;
    const drift = await reportDriftForEvent({ event, reuseLog: values.log, skillRoot: path.resolve(import.meta.dirname, ".."),
      entries: await actionIndex(path.resolve(import.meta.dirname, ".."), []) });
    console.log(JSON.stringify({ settled: true, result: resolution.result, event, ...drift,
      nextStep: resolution.result === "drift"
        ? `Redo this intent with Computer Use; at closeout pnpm action:drift list, repair ${event.action}, then pnpm action:drift verify ${event.action}`
        : null }));
    return;
  }
  const run = await readRun();
  if (!run.events.length) throw new Error("Action reuse log has no executed intents: metrics are unmeasured");
  for (const event of run.events) await verifyHit(event, false);
  // Unsettled cross-checks are listed apart (unconfirmedCrossChecks) and are not hits; the summary
  // checker freeze refuses them until action:reuse confirm settles each one.
  console.log(JSON.stringify({ runId: run.preflight.runId, ...summarizeReuse(run.events) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
