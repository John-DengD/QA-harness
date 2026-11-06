import { copyFile, lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  aggregateLaneCleanup, caseReviewStatus, checkedPath, hashFile, laneCloseoutRef, laneMergedCase, laneMergedRef,
  normalizeCheckerDraft, parseLaneCloseout, readJson,
  type CaseCheckerPacket, type CheckerCase, type CheckerDraft, type CheckerLane, type LaneCloseout,
} from "./checker";
import { readOmissionPlan } from "./omission";
import { inspectRun, listLaneRuns } from "./state";

export interface MergeOptions {
  mergedRunId: string;
  /** QA_ROOT-relative path the merged report will be written to (under the feature's `result/`). */
  report: string;
  /** QA_ROOT-relative, new directory under the merged run root that `report:bundle:qa` will fill. */
  bundle: string;
  outcome: "通过" | "不通过";
  /** Regenerate files this command already wrote (any earlier merged packet is then stale and must be re-frozen). */
  replace?: boolean;
}

export interface MergeResult {
  mergedRunId: string;
  lanes: { lane: string; runId: string; caseIds: number[] }[];
  cases: { id: number; caseKey: string; lane: string; status: string; executed: boolean }[];
  /** Cases the lanes carry that the frozen omission plan did not list (incremental additions). */
  addedCaseKeys: string[];
  copied: number;
  input: string;
  evidenceDir: string;
}

const MERGE_RECORD = "run-state/lane-merge.json";

type LaneInfo = {
  lane: CheckerLane;
  closeout: LaneCloseout;
  packets: Map<number, { ref: string; reviewRef: string; packet: CaseCheckerPacket }>;
};

type Planned = { ref: string; content: string | Buffer } | { ref: string; from: string };

async function sameContent(qaRoot: string, left: string, right: string): Promise<boolean> {
  return (await hashFile(qaRoot, left)).sha256 === (await hashFile(qaRoot, right)).sha256;
}

async function exists(qaRoot: string, ref: string): Promise<boolean> {
  try { await checkedPath(qaRoot, ref); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Create `ref`'s parent directories one component at a time, refusing symlinks. */
async function ensureParent(qaRoot: string, ref: string): Promise<string> {
  const root = path.resolve(qaRoot);
  let current = root;
  for (const component of path.posix.dirname(ref).split("/")) {
    if (component === ".") continue;
    current = path.join(current, component);
    try { await mkdir(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if ((await lstat(current)).isSymbolicLink() || !(await stat(current)).isDirectory()) {
      throw new Error(`Refusing to write through a symlink or non-directory: ${path.posix.dirname(ref)}`);
    }
  }
  return path.join(root, ref);
}

/**
 * Prepare the merged run from finished lane runs (`qa:checker merge`). It validates every lane, then writes under the
 * merged run root only: byte-identical evidence copies, the merged video manifest, case-harvest, cleanup and
 * run-state records, `run-state/lane-merge.json` and `run-state/checker-input.json`. Lane files are never changed,
 * so every lane Case packet and review still verifies; the merged summary packet links them.
 */
export async function mergeLanes(qaRoot: string, options: MergeOptions): Promise<MergeResult> {
  const merged = await inspectRun(qaRoot, options.mergedRunId);
  if (!merged.lanes) throw new Error(`Run ${merged.runId} is not a merged run (register it with loop:state init --lanes)`);
  if (!["executing", "changes_requested"].includes(merged.phase)) {
    throw new Error(`Merged run ${merged.runId} is ${merged.phase}; merge while it is executing (or changes_requested after a review)`);
  }
  let plan: Awaited<ReturnType<typeof readOmissionPlan>>;
  try { plan = await readOmissionPlan(qaRoot, merged.runId); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Merged run ${merged.runId} needs its frozen omission plan (omission:hook freeze) before lanes can be merged`);
    }
    throw error;
  }
  const runs = await listLaneRuns(qaRoot, merged.runId);
  const infos: LaneInfo[] = [];
  for (const label of merged.lanes) {
    const run = runs.find((item) => item.lane === label);
    if (!run) throw new Error(`Lane ${label} of ${merged.runId} has no registered run`);
    if (run.phase !== "awaiting_review") {
      throw new Error(`Lane ${label} (${run.runId}) is ${run.phase}; finish it (all Case reviews upheld, closeout written, checkpoint awaiting_review) before merging`);
    }
    const lane: CheckerLane = { lane: label, runId: run.runId, runRoot: run.runRoot, executorId: run.executorId, scope: run.scope,
      caseIds: [], closeout: laneCloseoutRef(run.runRoot) };
    const closeout = parseLaneCloseout(await readJson(qaRoot, lane.closeout), lane);
    lane.caseIds = closeout.cases.map((entry) => entry.id).sort((a, b) => a - b);
    infos.push({ lane, closeout, packets: new Map() });
  }

  // One Case ID / caseKey belongs to one lane.
  const byId = new Map<number, string>();
  const byKey = new Map<string, { lane: string; id: number }>();
  for (const { lane, closeout } of infos) {
    for (const entry of closeout.cases) {
      if (byId.has(entry.id)) throw new Error(`Case ID ${entry.id} appears in lanes ${byId.get(entry.id)} and ${lane.lane}; assign disjoint Case IDs per lane`);
      byId.set(entry.id, lane.lane);
      if (byKey.has(entry.caseKey)) throw new Error(`caseKey ${entry.caseKey} appears in lanes ${byKey.get(entry.caseKey)!.lane} and ${lane.lane}`);
      byKey.set(entry.caseKey, { lane: lane.lane, id: entry.id });
    }
  }
  // The lanes must carry exactly the Cases the merged plan assigned to them.
  for (const planned of plan.cases) {
    const found = byKey.get(planned.caseKey);
    if (!found) throw new Error(`Planned Case ${planned.caseKey} (lane ${planned.lane}) is missing from every lane`);
    if (found.lane !== planned.lane) {
      throw new Error(`Planned Case ${planned.caseKey} is assigned to lane ${planned.lane} but carried by lane ${found.lane}`);
    }
  }
  const plannedKeys = new Set(plan.cases.map((planned) => planned.caseKey));
  const addedCaseKeys = [...byKey.keys()].filter((key) => !plannedKeys.has(key)).sort();

  // Every executed Case keeps the independent review its own lane obtained; none of it is redone here.
  for (const info of infos) {
    const status = await caseReviewStatus(qaRoot, info.lane.runRoot);
    for (const entry of status.cases) {
      if (!info.lane.caseIds.includes(entry.caseId)) {
        throw new Error(`Lane ${info.lane.lane} has Case review state for Case ${entry.caseId}, which its closeout does not list`);
      }
    }
    for (const entry of info.closeout.cases) {
      const state = status.cases.find((item) => item.caseId === entry.id);
      if (!entry.executed) {
        if (state && state.state !== "not_required") throw new Error(`Lane ${info.lane.lane} Case ${entry.id} is not executed but has a Case packet`);
        continue;
      }
      if (!state || state.state !== "upheld") {
        throw new Error(`Lane ${info.lane.lane} Case ${entry.id} has no valid upheld Case review (${state?.state ?? "not_frozen"}${state?.reason ? `: ${state.reason}` : ""})`);
      }
      const packet = await readJson(qaRoot, state.packet!) as CaseCheckerPacket;
      if (packet.case.caseKey !== entry.caseKey || packet.case.status !== entry.status) {
        throw new Error(`Lane ${info.lane.lane} Case ${entry.id} differs between its closeout and its reviewed Case packet`);
      }
      info.packets.set(entry.id, { ref: state.packet!, reviewRef: state.review!, packet });
    }
  }

  // Merged Cases and the files they need under the merged run root.
  const cases: CheckerCase[] = [];
  const caseLane = new Map<number, LaneInfo>();
  const plannedWrites: Planned[] = [];
  const copies = new Map<string, string>();
  const caseReviews: NonNullable<CheckerDraft["caseReviews"]> = [];
  const manifestCases: unknown[] = [];
  const evidenceDir = `${merged.runRoot}/evidence`;
  for (const info of infos) {
    const laneManifest = await readJson(qaRoot, info.closeout.refs.videoManifest) as { cases?: { id: number; screenshots?: { path: string; caption: string }[] }[] };
    for (const entry of info.closeout.cases) {
      caseLane.set(entry.id, info);
      const reviewed = info.packets.get(entry.id);
      const source = reviewed ? reviewed.packet.case : entry;
      cases.push(laneMergedCase(source, info.lane, merged.runRoot));
      const refs = [...source.evidenceRefs, ...source.expected.flatMap((atom) => [atom.sourceRef, ...atom.evidenceRefs])];
      if (!reviewed) {
        manifestCases.push({ id: entry.id, status: entry.status, executed: false });
      } else {
        const packet = reviewed.packet;
        refs.push(packet.refs.video, ...packet.refs.screenshots, ...packet.refs.facts);
        caseReviews.push({ caseId: entry.id, packet: reviewed.ref, review: reviewed.reviewRef });
        const captions = new Map((laneManifest.cases?.find((item) => item.id === entry.id)?.screenshots ?? [])
          .map((shot) => [path.posix.join(info.closeout.evidenceDir, shot.path), shot.caption]));
        manifestCases.push({
          id: entry.id, status: packet.case.status, executed: true,
          video: path.posix.relative(evidenceDir, laneMergedRef(packet.refs.video, info.lane, merged.runRoot)),
          ...(packet.refs.screenshots.length ? { screenshots: packet.refs.screenshots.map((shot) => {
            const caption = captions.get(shot);
            if (!caption) throw new Error(`Lane ${info.lane.lane} Case ${entry.id} screenshot ${shot} has no caption in the lane video manifest`);
            return { path: path.posix.relative(evidenceDir, laneMergedRef(shot, info.lane, merged.runRoot)), caption };
          }) } : {}),
        });
      }
      for (const laneRef of refs) {
        const ref = laneMergedRef(laneRef, info.lane, merged.runRoot);
        if (ref !== laneRef) copies.set(ref, laneRef);
      }
    }
  }
  cases.sort((a, b) => a.id - b.id);
  caseReviews.sort((a, b) => a.caseId - b.caseId);
  manifestCases.sort((a, b) => (a as { id: number }).id - (b as { id: number }).id);
  for (const [ref, laneRef] of copies) {
    if (ref === `${merged.runRoot}/tickets/pr-spec.json`) {
      // The merged run owns one PR spec snapshot; every lane that cites one must hold the same bytes.
      if (!await exists(qaRoot, ref)) throw new Error(`Lane ${laneRef} cites a PR spec snapshot but the merged run has no ${ref}`);
      if (!await sameContent(qaRoot, ref, laneRef)) throw new Error(`PR spec snapshot ${laneRef} differs from the merged run's ${ref}`);
    } else plannedWrites.push({ ref, from: laneRef });
  }

  const cleanup = aggregateLaneCleanup(infos.map(({ lane, closeout }) => ({ lane: lane.lane, cleanup: closeout.cleanup })));
  const harvest = ["# Merged case harvest", "", ...(await Promise.all(infos.map(async ({ lane, closeout }) =>
    `## Lane ${lane.lane} (${lane.runId})\n\n${(await readFile(await checkedPath(qaRoot, closeout.refs.caseHarvest), "utf8")).trim()}\n`)))].join("\n");
  const cleanupText = ["# Merged cleanup", "", `Aggregate: ${cleanup.state}${cleanup.actionUnknown ? ", action_unknown" : ""}${cleanup.reason ? ` (${cleanup.reason})` : ""}`, "",
    ...(await Promise.all(infos.map(async ({ lane, closeout }) =>
      `## Lane ${lane.lane} (${lane.runId}): ${closeout.cleanup.state}${closeout.cleanup.actionUnknown ? ", action_unknown" : ""}\n\n` +
      `${(await readFile(await checkedPath(qaRoot, closeout.refs.cleanup), "utf8")).trim()}\n`)))].join("\n");
  const runState = ["# Merged run state", "", "| Lane | Run | Executor | Role | Org | Cases |", "|---|---|---|---|---|---|",
    ...infos.map(({ lane }) => `| ${lane.lane} | ${lane.runId} | ${lane.executorId} | ${lane.scope.role} | ${lane.scope.orgAlias} | ${lane.caseIds.join(", ")} |`), ""].join("\n");

  const prefix = `${merged.runRoot}/run-state`;
  const refs = {
    taskModel: merged.refs.taskModel, caseHarvest: `${prefix}/case-harvest.md`, videoManifest: `${prefix}/video-manifest.json`,
    runState: `${prefix}/run-state.md`, report: options.report, cleanup: `${prefix}/cleanup.md`,
  };
  const draft: CheckerDraft = {
    schemaVersion: 1, runId: merged.runId, executorId: merged.executorId, journeyKey: merged.journeyKey, mode: merged.mode,
    scope: merged.scope, runRoot: merged.runRoot, evidenceDir, bundleDir: options.bundle, refs,
    reportOutcome: options.outcome, cleanup, cases, caseReviews, lanes: infos.map(({ lane }) => lane),
  };
  normalizeCheckerDraft(draft);

  plannedWrites.push(
    { ref: refs.caseHarvest, content: `${harvest}\n` }, { ref: refs.cleanup, content: `${cleanupText}\n` },
    { ref: refs.runState, content: runState },
    { ref: refs.videoManifest, content: `${JSON.stringify({ cases: manifestCases }, null, 2)}\n` },
    { ref: `${merged.runRoot}/${MERGE_RECORD}`, content: `${JSON.stringify({
      schemaVersion: 1, mergedRunId: merged.runId,
      lanes: infos.map(({ lane }) => ({ lane: lane.lane, runId: lane.runId, runRoot: lane.runRoot, caseIds: lane.caseIds })),
      copies: [...copies].map(([ref, from]) => ({ ref, from })), addedCaseKeys,
    }, null, 2)}\n` },
    { ref: `${prefix}/checker-input.json`, content: `${JSON.stringify(draft, null, 2)}\n` },
  );

  // Refuse before writing anything when a target holds different content.
  for (const write of plannedWrites) {
    if (!await exists(qaRoot, write.ref)) continue;
    const same = "from" in write ? await sameContent(qaRoot, write.ref, write.from)
      : (await readFile(await checkedPath(qaRoot, write.ref))).equals(Buffer.from(write.content));
    if (!same && !options.replace) {
      throw new Error(`${write.ref} already exists with different content; pass --replace to regenerate it (an earlier merged packet is then stale and must be re-frozen under a new name)`);
    }
  }
  for (const write of plannedWrites) {
    const destination = await ensureParent(qaRoot, write.ref);
    if ("from" in write) {
      await copyFile(await checkedPath(qaRoot, write.from), destination);
      if (!await sameContent(qaRoot, write.ref, write.from)) throw new Error(`Copy of ${write.from} is not byte-identical`);
    } else await writeFile(destination, write.content);
  }
  return {
    mergedRunId: merged.runId,
    lanes: infos.map(({ lane }) => ({ lane: lane.lane, runId: lane.runId, caseIds: lane.caseIds })),
    cases: cases.map((entry) => ({ id: entry.id, caseKey: entry.caseKey, lane: caseLane.get(entry.id)!.lane.lane,
      status: entry.status, executed: entry.executed })),
    addedCaseKeys, copied: copies.size, input: `${prefix}/checker-input.json`, evidenceDir,
  };
}
