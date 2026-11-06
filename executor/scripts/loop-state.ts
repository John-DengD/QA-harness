import { parseArgs } from "node:util";
import { loadQaEnv } from "../src/tools/qa-env";
import { resolveQaRootOption } from "../src/tools/qa-root";
import {
  addFollowup, checkpointRun, claimFollowup, heartbeatRun, initRun, inspectFollowup, inspectRun,
  listComparableRuns, listFollowups, reconcileRun, resolveFollowup,
  type GapKind, type RunIdentity, type RunPhase, type RunRefs,
} from "../src/loop/state";

const usage = `Usage: loop:state <command> [--qa-root <QA_ROOT>] ...
  --qa-root is optional when QA_ROOT is set (env or qa-env/.env.local; see pnpm qa:init).
  QA_ROOT is the directory holding .qa-loop (print it with pnpm qa-env:root); every path is QA_ROOT-relative.
  init --run-id ID --run-root [<surface>/]<feature>/runs/ID --journey-key KEY --mode new|regression --feature KEY
       --environment KEY --role KEY --org-alias KEY --sha KEY
       --executor-id KEY --task-model QA_ROOT/relative/path [--parent-run-id ID]
       [--lanes LABEL,LABEL,...]            merged run: executes no Case, owns the plan/report/summary review
       [--lane-of MERGED_RUN_ID --lane LABEL]  lane run: executes Cases, merged later by qa:checker merge
  checkpoint --run-id ID --executor-id KEY --phase PHASE
       [--ref NAME=relative/path ...] [--recovery-ref relative/path]
       NAME is one of: taskModel, actionLog, caseHarvest, videoManifest, runState, report,
       checkerPacket, checkerReview, bundle (a directory), delivery.
       Phases: planned -> executing -> awaiting_review -> reviewed -> published
       (changes_requested / interrupted branch off); record-start never moves the phase.
  inspect --run-id ID
  list --compare-to RUN_ID
  heartbeat --run-id ID --executor-id KEY
  reconcile --run-id ID --after-ms 300000 --confirmed-inactive
  add-gap --gap-id ID --journey-key KEY --mechanism-key KEY
       --kind action_miss|case_gap|knowledge_gap|fixture|script_drift
       [--intent-key KEY (required for action_miss)]
       --source-run ID --case-id ID --source-ref relative/path
       --next-trigger KEY [--prerequisite KEY ...]
  queue [--journey-key KEY] [--all]
  claim --gap-id ID --run-id ID --executor-id KEY [--lease-ms 3600000]
  resolve --gap-id ID --run-id ID --executor-id KEY --resolution validated|retired
       --case-id ID --resolution-ref relative/path [--reason KEY]`;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing --${name}\n${usage}`);
  return value;
}

function finiteMilliseconds(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("Expected non-negative integer milliseconds");
  return Number(value);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { positionals, values } = parseArgs({
    args, allowPositionals: true, options: {
      "qa-root": { type: "string" }, "run-id": { type: "string" },
      "run-root": { type: "string" },
      "journey-key": { type: "string" }, mode: { type: "string" },
      feature: { type: "string" }, environment: { type: "string" },
      role: { type: "string" }, "org-alias": { type: "string" },
      sha: { type: "string" }, "executor-id": { type: "string" },
      "parent-run-id": { type: "string" }, "task-model": { type: "string" },
      lanes: { type: "string" }, "lane-of": { type: "string" }, lane: { type: "string" },
      phase: { type: "string" }, ref: { type: "string", multiple: true },
      "recovery-ref": { type: "string" }, "compare-to": { type: "string" },
      "after-ms": { type: "string" }, "confirmed-inactive": { type: "boolean" },
      "gap-id": { type: "string" },
      "mechanism-key": { type: "string" }, kind: { type: "string" },
      "intent-key": { type: "string" },
      "source-run": { type: "string" }, "case-id": { type: "string" },
      "source-ref": { type: "string" }, prerequisite: { type: "string", multiple: true },
      "next-trigger": { type: "string" }, all: { type: "boolean" },
      "lease-ms": { type: "string" }, resolution: { type: "string" },
      "resolution-ref": { type: "string" }, reason: { type: "string" },
    },
  });
  if (positionals.length !== 1) throw new Error(usage);
  loadQaEnv();
  const qaRoot = resolveQaRootOption(values["qa-root"]);
  const command = positionals[0];
  let result: unknown;
  if (command === "init") {
    const identity: RunIdentity = {
      runId: required(values["run-id"], "run-id"),
      runRoot: required(values["run-root"], "run-root"),
      journeyKey: required(values["journey-key"], "journey-key"),
      mode: required(values.mode, "mode") as RunIdentity["mode"],
      scope: {
        feature: required(values.feature, "feature"),
        environment: required(values.environment, "environment"),
        role: required(values.role, "role"),
        orgAlias: required(values["org-alias"], "org-alias"),
        deploymentSha: required(values.sha, "sha"),
      },
      executorId: required(values["executor-id"], "executor-id"),
      ...(values["parent-run-id"] ? { parentRunId: values["parent-run-id"] } : {}),
      ...(values["lane-of"] ? { laneOf: values["lane-of"] } : {}),
      ...(values.lane ? { lane: values.lane } : {}),
      ...(values.lanes ? { lanes: values.lanes.split(",").map((label) => label.trim()) } : {}),
    };
    result = await initRun(qaRoot, identity, { taskModel: required(values["task-model"], "task-model") });
  } else if (command === "checkpoint") {
    const refs: Partial<RunRefs> = {};
    for (const assignment of values.ref ?? []) {
      const equals = assignment.indexOf("=");
      if (equals <= 0) throw new Error("--ref must be name=QA_ROOT-relative/path");
      const name = assignment.slice(0, equals) as keyof RunRefs;
      if (Object.hasOwn(refs, name)) throw new Error(`Duplicate run reference: ${name}`);
      refs[name] = assignment.slice(equals + 1);
    }
    result = await checkpointRun(qaRoot, required(values["run-id"], "run-id"),
      required(values["executor-id"], "executor-id"), required(values.phase, "phase") as RunPhase,
      { refs, recoveryRef: values["recovery-ref"] });
  } else if (command === "inspect") {
    result = await inspectRun(qaRoot, required(values["run-id"], "run-id"));
  } else if (command === "list") {
    result = await listComparableRuns(qaRoot, required(values["compare-to"], "compare-to"));
  } else if (command === "heartbeat") {
    result = await heartbeatRun(qaRoot, required(values["run-id"], "run-id"),
      required(values["executor-id"], "executor-id"));
  } else if (command === "reconcile") {
    result = await reconcileRun(qaRoot, required(values["run-id"], "run-id"),
      finiteMilliseconds(values["after-ms"], 300_000), values["confirmed-inactive"] === true);
  } else if (command === "add-gap") {
    result = await addFollowup(qaRoot, {
      gapId: required(values["gap-id"], "gap-id"),
      journeyKey: required(values["journey-key"], "journey-key"),
      mechanismKey: required(values["mechanism-key"], "mechanism-key"),
      kind: required(values.kind, "kind") as GapKind,
      ...(values["intent-key"] ? { intentKey: values["intent-key"] } : {}),
      source: {
        runId: required(values["source-run"], "source-run"),
        caseId: required(values["case-id"], "case-id"),
        ref: required(values["source-ref"], "source-ref"),
      },
      prerequisites: values.prerequisite ?? [],
      nextTrigger: required(values["next-trigger"], "next-trigger"),
    });
  } else if (command === "queue") {
    const gaps = await listFollowups(qaRoot, values["journey-key"]);
    result = values.all ? gaps : gaps.filter((gap) => gap.status === "open" ||
      (gap.status === "claimed" && gap.claim && Date.parse(gap.claim.expiresAt) <= Date.now()));
  } else if (command === "claim") {
    result = await claimFollowup(qaRoot, required(values["gap-id"], "gap-id"),
      required(values["run-id"], "run-id"), required(values["executor-id"], "executor-id"),
      finiteMilliseconds(values["lease-ms"], 3_600_000));
  } else if (command === "resolve") {
    result = await resolveFollowup(qaRoot, required(values["gap-id"], "gap-id"),
      required(values["run-id"], "run-id"), required(values["executor-id"], "executor-id"), {
        kind: required(values.resolution, "resolution") as "validated" | "retired",
        caseId: required(values["case-id"], "case-id"),
        ref: required(values["resolution-ref"], "resolution-ref"),
        ...(values.reason ? { reason: values.reason } : {}),
      });
  } else if (command === "inspect-gap") {
    result = await inspectFollowup(qaRoot, required(values["gap-id"], "gap-id"));
  } else {
    throw new Error(usage);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
