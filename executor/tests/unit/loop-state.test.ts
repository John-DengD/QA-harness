import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeCheckerPacket, type CheckerDraft, type CheckerReview } from "../../src/loop/checker";
import { decideOmission, findOmission, freezeOmissionPlan } from "../../src/loop/omission";
import { canonicalInvocationJson, sha256Bytes } from "../../src/tools/action-invocation";
import {
  addFollowup, assertQaRef, checkpointRun, claimFollowup, heartbeatRun, initRun, inspectFollowup,
  inspectRun, listComparableRuns, listFollowups, reconcileRun, resolveFollowup,
  type RunIdentity,
} from "../../src/loop/state";

const temporaryRoots: string[] = [];
const at = (time: string) => new Date(time);
// Surface prefix of the run root ("" = feature directly under QA_ROOT); reset after each test.
let surface = "";
const runRoot = (runId: string) => `${surface}PR-1217/runs/${runId}`;

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qa-loop-state-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, surface, "PR-1217", "runs"), { recursive: true });
  return root;
}

function identity(runId: string, overrides: Partial<RunIdentity> = {}): RunIdentity {
  return {
    runId, runRoot: runRoot(runId), journeyKey: "google-tracking-launch", mode: "new",
    scope: { feature: "PR-1217", environment: "staging", role: "customer", orgAlias: "qa-1", deploymentSha: "a868f1f" },
    executorId: "agent-1", ...overrides,
  };
}

async function create(root: string, runId = "run-1", overrides: Partial<RunIdentity> = {}, freezePlan = true) {
  const currentIdentity = identity(runId, overrides);
  const prefix = currentIdentity.runRoot;
  await mkdir(path.join(root, prefix, "run-state"), { recursive: true });
  await writeFile(path.join(root, prefix, "run-state", "ticket-task-model.md"), "# QA-1149\n");
  await writeFile(path.join(root, prefix, "run-state", "case-harvest.md"), "# Case 1\n");
  const run = await initRun(root, currentIdentity, { taskModel: `${prefix}/run-state/ticket-task-model.md` }, at("2026-10-10T10:00:00Z"));
  if (freezePlan) {
    await freezeOmissionPlan(root, {
      schemaVersion: 1, runId,
      targets: [{ targetKey: "tracking", description: "Tracking readiness", sourceRef: run.refs.taskModel,
        anchor: "QA-1149" }],
      mechanisms: [{ mechanismKey: "tracking-readiness", category: "negative", targetKeys: ["tracking"], applicable: true }],
      cases: [{ caseKey: "tracking-readiness", category: "negative", mechanismKeys: ["tracking-readiness"] }],
    }, at("2026-10-10T10:00:01Z"));
  }
  return run;
}

async function freezeReviewedCase(root: string, runId: string, mechanismKey: string, status: "Pass" | "Blocked" = "Pass") {
  const prefix = runRoot(runId);
  await mkdir(path.join(root, prefix, "evidence", "case-1"), { recursive: true });
  await mkdir(path.join(root, surface, "PR-1217", "result"), { recursive: true });
  const video = `${prefix}/evidence/case-1/video.mp4`;
  await writeFile(path.join(root, video), "test video bytes");
  await writeFile(path.join(root, prefix, "run-state", "video-manifest.json"), JSON.stringify({ cases: [
    { id: 1, status, executed: true, video: "case-1/video.mp4" },
  ] }));
  await writeFile(path.join(root, prefix, "run-state", "run-state.md"), "# Cleanup verified\n");
  await writeFile(path.join(root, prefix, "run-state", "cleanup.md"), "No unknown effects\n");
  const actionLog = `${prefix}/run-state/action-reuse.jsonl`;
  const invocationId = randomUUID();
  const factRef = `${prefix}/evidence/case-1/playwright/actions/${invocationId}.json`;
  await mkdir(path.dirname(path.join(root, factRef)), { recursive: true });
  const beforeScreenshot = `${invocationId}-before.png`;
  const afterScreenshot = `${invocationId}-after.png`;
  const factBody = {
    kind: "action-invocation", schemaVersion: 1, invocationId, runId, caseId: "case-1", intentId: "read-tracking",
    action: "readGoogleTrackingReadiness", domain: "google-tracking", sandboxId: "sandbox1",
    origin: "https://qa.example.test", sideEffect: "read", status: "completed",
    startedAt: "2026-10-12T01:00:00Z", finishedAt: "2026-10-12T01:00:01Z",
    lookupMs: 4, executionMs: 120, factPath: `playwright/actions/${invocationId}.json`,
    beforeScreenshot, afterScreenshot,
    target: { origin: "https://qa.example.test", beforeScreenshot: `playwright/actions/${beforeScreenshot}`,
      afterScreenshot: `playwright/actions/${afterScreenshot}` },
    fact: { cardState: "ready" }, error: null,
  };
  const factBytes = JSON.stringify({ ...factBody, integrityHash: sha256Bytes(canonicalInvocationJson(factBody)) }) + "\n";
  await writeFile(path.join(root, factRef), factBytes);
  await writeFile(path.join(root, path.posix.dirname(factRef), beforeScreenshot), "before screenshot");
  await writeFile(path.join(root, path.posix.dirname(factRef), afterScreenshot), "after screenshot");
  await writeFile(path.join(root, actionLog), [
    JSON.stringify({ kind: "preflight", runId, createdAt: "2026-10-12T00:00:00Z", indexedActions: 1, hotCandidates: [] }),
    JSON.stringify({ runId, caseId: "case-1", intentId: "read-tracking", intent: "read tracking readiness",
      outcome: "hit", source: "index", action: "readGoogleTrackingReadiness", lookupMs: 4, executionMs: 120,
      invocationId, factRef: path.relative(path.dirname(actionLog), factRef), factSha256: sha256Bytes(factBytes) }),
  ].join("\n") + "\n");
  const outcome = status === "Pass" ? "通过" : "不通过";
  const report = `${surface}PR-1217/result/${runId}.md`;
  await writeFile(path.join(root, report), `# QA\n\n## 整体结论\n\n**${outcome}**\n\n### Case 1 · tracking readiness\n\n- **结论**：${status}\n`);
  const bundle = `${prefix}/agent-qa-report-test`;
  await mkdir(path.join(root, bundle, "videos"), { recursive: true });
  await writeFile(path.join(root, bundle, "qa-report.md"), await readFile(path.join(root, report), "utf8"));
  await writeFile(path.join(root, bundle, "videos/case-1.mp4"), await readFile(path.join(root, video)));
  await writeFile(path.join(root, bundle, "index.html"),
    `<strong>${outcome}</strong><a href="#case-1"><b>${status === "Pass" ? "通过" : "阻塞"}</b></a>` +
    '<section id="case-1"><video src="./videos/case-1.mp4"></video></section>');
  const draft: CheckerDraft = {
    schemaVersion: 1, runId, executorId: "agent-1", journeyKey: "google-tracking-launch", mode: "new",
    runRoot: prefix, bundleDir: bundle, scope: identity(runId).scope,
    evidenceDir: `${prefix}/evidence`,
    refs: {
      taskModel: `${prefix}/run-state/ticket-task-model.md`,
      actionLog,
      caseHarvest: `${prefix}/run-state/case-harvest.md`,
      videoManifest: `${prefix}/run-state/video-manifest.json`,
      runState: `${prefix}/run-state/run-state.md`,
      cleanup: `${prefix}/run-state/cleanup.md`, report,
    },
    reportOutcome: outcome, cleanup: { state: "verified", actionUnknown: false },
    cases: [{
      id: 1, caseKey: mechanismKey, category: "negative", riskMechanism: "missing tracker",
      expected: [{
        sourceKind: "ticket", sourceRef: `${prefix}/run-state/ticket-task-model.md`,
        anchor: "QA-1149 tracking", appliesWhen: "QA 1 Sales draft", evidenceRefs: [video],
      }], status, applicable: true, executed: true, evidenceRefs: [video],
      ...(status === "Blocked" ? { reason: "Fixture unavailable", resumeCondition: "Reset fixture" } : {}),
    }],
  };
  const packet = await freezeCheckerPacket(root, draft);
  const packetRef = `${prefix}/run-state/checker-packet.json`;
  const reviewRef = `${prefix}/run-state/checker-review.json`;
  const review: CheckerReview = {
    schemaVersion: 1, runId, reviewerId: "checker-2", packetDigest: packet.digest,
    caseReviews: [{ id: 1, disposition: "upheld", reason: "Expected and video agree" }],
    qaApprovalEligible: status === "Pass", artifactPublishable: true, reasons: [],
  };
  await writeFile(path.join(root, packetRef), JSON.stringify(packet));
  await writeFile(path.join(root, reviewRef), JSON.stringify(review));
  return { packetRef, reviewRef, video, report, bundle, packet, review };
}

async function requiredOmission(root: string, runId: string) {
  const prefix = runRoot(runId);
  const sourceRef = `${prefix}/run-state/ticket-task-model.md`;
  const reviewRef = `${prefix}/run-state/omission-review.md`;
  await writeFile(path.join(root, reviewRef), "Independent review: edge retry is required.\n");
  const finding = await findOmission(root, runId, {
    mechanismKey: "edge-retry", category: "edge", targetKeys: ["tracking"],
    source: "self_critic", actorId: "agent-1", reason: "Retry can leave tracking incomplete",
    expectedAuthority: "ticket", evidenceRefs: [sourceRef],
  });
  await decideOmission(root, runId, {
    findingId: finding.eventId, reviewerId: "checker-2", status: "confirmed", requiredForApproval: true,
    reason: "This separate edge mechanism is required", reviewRef,
  });
}

async function deliveryReceipt(root: string, runId: string,
  evidence: Awaited<ReturnType<typeof freezeReviewedCase>>) {
  const delivery = `${runRoot(runId)}/run-state/delivery.json`;
  const receipt = {
    schemaVersion: 1, runId, packetDigest: evidence.packet.digest,
    artifactUrl: "https://artifact.cafe/a/pr-1217-google-tracking-qa-gppy9i",
    workspace: "hellyeah", visibility: "workspace", bundleDir: evidence.bundle,
    artifactId: "pr-1217-google-tracking-qa-gppy9i", version: 4,
    onlineChecks: { shaMatched: true, casesVisible: true, videosChecked: true, workspaceAccess: true, videoCaseIds: [1] },
    publishedAt: "2026-10-12T11:00:00Z", verifiedAt: "2026-10-12T11:02:00Z",
  };
  await writeFile(path.join(root, delivery), JSON.stringify(receipt));
  return { delivery, receipt };
}

afterEach(async () => {
  surface = "";
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable QA run state", () => {
  it("creates each run once, persists only references and keeps comparable runs separated", async () => {
    const root = await workspace();
    await create(root);
    await expect(create(root)).rejects.toMatchObject({ code: "EEXIST" });
    await create(root, "run-2", {
      runRoot: "PR-1220/runs/run-2",
      scope: { ...identity("run-2").scope, feature: "PR-1220", deploymentSha: "deadbee" },
    });
    await create(root, "run-3", { mode: "regression" });
    await create(root, "run-4", { scope: { ...identity("run-4").scope, orgAlias: "qa-2" } });
    expect((await listComparableRuns(root, "run-1")).map((run) => run.runId)).toEqual(["run-2"]);
    const stored = await readFile(path.join(root, ".qa-loop", "runs", "run-1.json"), "utf8");
    expect(stored).toContain('"taskModel"');
    expect(stored).not.toContain("Expected");
    expect(stored).not.toContain("video.mp4");
  });

  it("requires checker artifacts to mark reviewed but does not equate review with Pass", async () => {
    const root = await workspace();
    await create(root);
    await checkpointRun(root, "run-1", "agent-1", "executing");
    await checkpointRun(root, "run-1", "agent-1", "awaiting_review");
    await expect(checkpointRun(root, "run-1", "agent-1", "reviewed")).rejects.toThrow(/checker packet and review/);
    const evidence = await freezeReviewedCase(root, "run-1", "tracking-readiness");
    await writeFile(path.join(root, evidence.reviewRef), JSON.stringify({ ...evidence.review, reviewerId: "agent-1" }));
    await expect(checkpointRun(root, "run-1", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef,
    } })).rejects.toThrow(/reviewer must differ|reviewer must differ from executor|must differ from executor/i);
    await writeFile(path.join(root, evidence.reviewRef), JSON.stringify(evidence.review));
    const run = await checkpointRun(root, "run-1", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef,
      checkerReview: evidence.reviewRef,
    } });
    expect(run.phase).toBe("reviewed");
    expect(run).not.toHaveProperty("verdict");
    await expect(checkpointRun(root, "run-1", "agent-1", "published")).rejects.toThrow(/reviewed report bundle/);
    await expect(checkpointRun(root, "run-1", "another-agent", "published")).rejects.toThrow(/executor identity/);
  });

  it("runs the whole loop under a surface-prefixed run root with QA_ROOT at the top", async () => {
    surface = "User-Dashboard-test/";
    const root = await workspace();
    // create() also freezes the omission plan (human review ledger under the prefixed run root).
    await create(root);
    await checkpointRun(root, "run-1", "agent-1", "executing");
    await checkpointRun(root, "run-1", "agent-1", "awaiting_review");
    const evidence = await freezeReviewedCase(root, "run-1", "tracking-readiness");
    expect(evidence.packet.runRoot).toBe("User-Dashboard-test/PR-1217/runs/run-1");
    const reviewed = await checkpointRun(root, "run-1", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef, report: evidence.report,
    } });
    expect(reviewed.phase).toBe("reviewed");
    const { delivery } = await deliveryReceipt(root, "run-1", evidence);
    const published = await checkpointRun(root, "run-1", "agent-1", "published", { refs: { bundle: evidence.bundle, delivery } });
    expect(published.phase).toBe("published");
  });

  it("explains a checker packet frozen against another QA_ROOT instead of failing with ENOENT", async () => {
    surface = "User-Dashboard-test/";
    const root = await workspace();
    await create(root);
    await checkpointRun(root, "run-1", "agent-1", "executing");
    await checkpointRun(root, "run-1", "agent-1", "awaiting_review");
    const evidence = await freezeReviewedCase(root, "run-1", "tracking-readiness");
    const shifted = { ...evidence.packet, runRoot: "PR-1217/runs/run-1" };
    await writeFile(path.join(root, evidence.packetRef), JSON.stringify(shifted));
    await expect(checkpointRun(root, "run-1", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef,
    } })).rejects.toThrow(/frozen against another QA_ROOT/);
  });

  it("names the next phase when awaiting_review is requested straight from planned", async () => {
    const root = await workspace();
    await create(root);
    await expect(checkpointRun(root, "run-1", "agent-1", "awaiting_review"))
      .rejects.toThrow(/planned -> awaiting_review.*--phase executing/s);
  });

  it("publishes only an unchanged checker-approved bundle with a verified Artifact receipt", async () => {
    const root = await workspace();
    await create(root);
    await checkpointRun(root, "run-1", "agent-1", "executing");
    await checkpointRun(root, "run-1", "agent-1", "awaiting_review");
    const evidence = await freezeReviewedCase(root, "run-1", "tracking-readiness");
    await checkpointRun(root, "run-1", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef, report: evidence.report,
    } });
    const bundle = evidence.bundle;
    const { delivery, receipt } = await deliveryReceipt(root, "run-1", evidence);
    await writeFile(path.join(root, delivery), JSON.stringify({ ...receipt, verifiedAt: undefined }));
    await expect(checkpointRun(root, "run-1", "agent-1", "published", { refs: { bundle, delivery } }))
      .rejects.toThrow(/delivery.verifiedAt/);
    await writeFile(path.join(root, delivery), JSON.stringify({ ...receipt, version: 0 }));
    await expect(checkpointRun(root, "run-1", "agent-1", "published", { refs: { bundle, delivery } }))
      .rejects.toThrow(/positive Artifact version/);
    await writeFile(path.join(root, delivery), JSON.stringify({
      ...receipt, onlineChecks: { ...receipt.onlineChecks, videosChecked: false },
    }));
    await expect(checkpointRun(root, "run-1", "agent-1", "published", { refs: { bundle, delivery } }))
      .rejects.toThrow(/online readback/);
    await writeFile(path.join(root, delivery), JSON.stringify(receipt));
    const published = await checkpointRun(root, "run-1", "agent-1", "published", { refs: { bundle, delivery } });
    expect(published.phase).toBe("published");
    await expect(checkpointRun(root, "run-1", "agent-1", "published")).rejects.toThrow(/Invalid phase transition/);
  });

  it("cannot publish a reviewed run without a frozen omission plan", async () => {
    const root = await workspace();
    await create(root, "run-1", {}, false);
    await checkpointRun(root, "run-1", "agent-1", "executing");
    await checkpointRun(root, "run-1", "agent-1", "awaiting_review");
    const evidence = await freezeReviewedCase(root, "run-1", "tracking-readiness");
    await checkpointRun(root, "run-1", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef, report: evidence.report,
    } });
    const { delivery } = await deliveryReceipt(root, "run-1", evidence);
    await expect(checkpointRun(root, "run-1", "agent-1", "published", { refs: {
      bundle: evidence.bundle, delivery,
    } })).rejects.toThrow(/requires a frozen omission plan/);
    expect((await inspectRun(root, "run-1")).phase).toBe("reviewed");
  });

  it("blocks a claimed Pass with an uncovered required omission", async () => {
    const root = await workspace();
    await create(root);
    await requiredOmission(root, "run-1");
    await checkpointRun(root, "run-1", "agent-1", "executing");
    await checkpointRun(root, "run-1", "agent-1", "awaiting_review");
    const evidence = await freezeReviewedCase(root, "run-1", "tracking-readiness");
    await checkpointRun(root, "run-1", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef, report: evidence.report,
    } });
    const { delivery } = await deliveryReceipt(root, "run-1", evidence);
    await expect(checkpointRun(root, "run-1", "agent-1", "published", { refs: {
      bundle: evidence.bundle, delivery,
    } })).rejects.toThrow(/Omission gate did not approve Artifact publication: edge-retry/);
    expect((await inspectRun(root, "run-1")).phase).toBe("reviewed");
  });

  it("publishes an honest failed report while disclosing an open required omission", async () => {
    const root = await workspace();
    await create(root);
    await requiredOmission(root, "run-1");
    await checkpointRun(root, "run-1", "agent-1", "executing");
    await checkpointRun(root, "run-1", "agent-1", "awaiting_review");
    const evidence = await freezeReviewedCase(root, "run-1", "tracking-readiness", "Blocked");
    await checkpointRun(root, "run-1", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef, report: evidence.report,
    } });
    const { delivery } = await deliveryReceipt(root, "run-1", evidence);
    const published = await checkpointRun(root, "run-1", "agent-1", "published", { refs: {
      bundle: evidence.bundle, delivery,
    } });
    expect(published.phase).toBe("published");
    expect(evidence.packet.reportOutcome).toBe("不通过");
    expect(evidence.review.qaApprovalEligible).toBe(false);
  });

  it("marks a stale running shard interrupted and requires a separate recovery reference", async () => {
    const root = await workspace();
    await create(root);
    await checkpointRun(root, "run-1", "agent-1", "executing", {}, at("2026-10-10T10:01:00Z"));
    await expect(reconcileRun(root, "run-1", 300_000, false, at("2026-10-10T10:07:00Z")))
      .rejects.toThrow(/Confirm the executor/);
    expect((await heartbeatRun(root, "run-1", "agent-1", at("2026-10-10T10:03:00Z"))).updatedAt)
      .toBe("2026-10-10T10:03:00.000Z");
    expect((await reconcileRun(root, "run-1", 300_000, true, at("2026-10-10T10:04:00Z"))).phase)
      .toBe("executing");
    const interrupted = await reconcileRun(root, "run-1", 300_000, true, at("2026-10-10T10:09:00Z"));
    expect(interrupted).toMatchObject({ phase: "interrupted", recoveryRequired: true });
    await expect(checkpointRun(root, "run-1", "agent-1", "executing"))
      .rejects.toThrow(/side-effect reconciliation/);
    await expect(heartbeatRun(root, "run-1", "agent-1"))
      .rejects.toThrow(/Only the executing run owner/);
    await writeFile(path.join(root, runRoot("run-1"), "run-state", "run-state.md"), "read-only reconciled\n");
    expect(await checkpointRun(root, "run-1", "agent-1", "executing", {
      recoveryRef: `${runRoot("run-1")}/run-state/run-state.md`,
    })).toMatchObject({ phase: "executing", recoveryRequired: false });
    expect((await inspectRun(root, "run-1")).phase).toBe("executing");
  });

  it("rejects traversal and symlink references and does not leave files outside QA_ROOT", async () => {
    const root = await workspace();
    const outside = await mkdtemp(path.join(os.tmpdir(), "qa-loop-outside-"));
    temporaryRoots.push(outside);
    await writeFile(path.join(outside, "secret"), "secret");
    await symlink(outside, path.join(root, "external"));
    await expect(assertQaRef(root, "../outside")).rejects.toThrow(/relative paths/);
    await expect(assertQaRef(root, "external/secret")).rejects.toThrow(/outside QA_ROOT/);
    await mkdir(path.join(root, runRoot("run-1")), { recursive: true });
    await expect(initRun(root, identity("run-1"), { taskModel: "external/secret" }))
      .rejects.toThrow(/this runRoot/);
    await expect(initRun(root, identity("../../evil"), { taskModel: "external/secret" }))
      .rejects.toThrow(/runId/);
  });
});

describe("cross-run followup queue", () => {
  async function gap(root: string) {
    await create(root);
    return addFollowup(root, {
      gapId: "tracking-read-action", journeyKey: "google-tracking-launch", mechanismKey: "tracking-readiness",
      kind: "action_miss", intentKey: "read-tracking", source: {
        runId: "run-1", caseId: "case-4", ref: `${runRoot("run-1")}/run-state/case-harvest.md`,
      }, prerequisites: ["real-page-path"], nextTrigger: "same-journey-regression",
    });
  }

  it("requires a real source reference and prevents duplicate stable gap IDs", async () => {
    const root = await workspace();
    await gap(root);
    await expect(claimFollowup(root, "tracking-read-action", "run-1", "agent-1"))
      .rejects.toThrow(/subsequent independent run/);
    expect((await listFollowups(root, "google-tracking-launch")).map((item) => item.gapId))
      .toEqual(["tracking-read-action"]);
    await expect(addFollowup(root, {
      gapId: "tracking-read-action", journeyKey: "google-tracking-launch", mechanismKey: "tracking-readiness",
      kind: "action_miss", intentKey: "read-tracking",
      source: { runId: "run-1", caseId: "case-4", ref: `${runRoot("run-1")}/run-state/case-harvest.md` },
      prerequisites: [], nextTrigger: "next-run",
    })).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("allows just one concurrent claimant and validates from another reviewed run", async () => {
    const root = await workspace();
    await gap(root);
    await create(root, "run-2");
    await create(root, "run-3");
    const claims = await Promise.allSettled([
      claimFollowup(root, "tracking-read-action", "run-2", "agent-1"),
      claimFollowup(root, "tracking-read-action", "run-3", "agent-1"),
    ]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    const current = await inspectFollowup(root, "tracking-read-action");
    expect(current.status).toBe("claimed");
    const claimant = current.claim!.runId;
    await expect(resolveFollowup(root, "tracking-read-action", claimant, "agent-1", {
      kind: "validated", caseId: "case-4", ref: `${runRoot(claimant)}/run-state/case-harvest.md`,
    })).rejects.toThrow(/independently reviewed/);
    await checkpointRun(root, claimant, "agent-1", "executing");
    await checkpointRun(root, claimant, "agent-1", "awaiting_review");
    const evidence = await freezeReviewedCase(root, claimant, "tracking-readiness");
    await checkpointRun(root, claimant, "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef,
    } });
    const resolved = await resolveFollowup(root, "tracking-read-action", claimant, "agent-1", {
      kind: "validated", caseId: "case-1", ref: evidence.video,
    });
    expect(resolved).toMatchObject({ status: "validated", resolution: { runId: claimant, caseId: "case-1" } });
    await expect(claimFollowup(root, "tracking-read-action", "run-3", "agent-1"))
      .rejects.toThrow(/resolved/);
  });

  it("reclaims an expired lease but never resolves a stale claimant automatically", async () => {
    const root = await workspace();
    await gap(root);
    await create(root, "run-2");
    await create(root, "run-3");
    await claimFollowup(root, "tracking-read-action", "run-2", "agent-1", 60_000, at("2026-10-10T10:00:00Z"));
    const claimed = await claimFollowup(root, "tracking-read-action", "run-3", "agent-1", 60_000, at("2026-10-10T10:02:00Z"));
    expect(claimed).toMatchObject({ status: "claimed", claim: { runId: "run-3" } });
    expect(claimed.resolution).toBeUndefined();
  });

  it("does not validate a gap using a Blocked Case even when its Action was called", async () => {
    const root = await workspace();
    await gap(root);
    await create(root, "run-2");
    await claimFollowup(root, "tracking-read-action", "run-2", "agent-1");
    await checkpointRun(root, "run-2", "agent-1", "executing");
    await checkpointRun(root, "run-2", "agent-1", "awaiting_review");
    const evidence = await freezeReviewedCase(root, "run-2", "tracking-readiness", "Blocked");
    await checkpointRun(root, "run-2", "agent-1", "reviewed", { refs: {
      checkerPacket: evidence.packetRef, checkerReview: evidence.reviewRef,
    } });
    await expect(resolveFollowup(root, "tracking-read-action", "run-2", "agent-1", {
      kind: "validated", caseId: "case-1", ref: evidence.video,
    })).rejects.toThrow(/upheld Case with matching mechanism/);
    expect((await inspectFollowup(root, "tracking-read-action")).status).toBe("claimed");
  });
});

it("exposes the local lifecycle through the CLI without writing QA results", async () => {
  const root = await workspace();
  const prefix = runRoot("cli-run");
  await mkdir(path.join(root, prefix, "run-state"), { recursive: true });
  await writeFile(path.join(root, prefix, "run-state", "ticket-task-model.md"), "# CLI run\n");
  const workdir = path.resolve(import.meta.dirname, "../..");
  const invoke = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/loop-state.ts", ...args], {
    cwd: workdir, encoding: "utf8",
  });
  const init = invoke("init", "--qa-root", root, "--run-id", "cli-run", "--run-root", prefix,
    "--journey-key", "google-tracking-launch",
    "--mode", "new", "--feature", "PR-1217", "--environment", "staging", "--role", "customer",
    "--org-alias", "qa-1", "--sha", "a868f1f", "--executor-id", "agent-1",
    "--task-model", `${prefix}/run-state/ticket-task-model.md`);
  expect(init.stderr).toBe("");
  expect(init.status).toBe(0);
  expect(JSON.parse(init.stdout)).toMatchObject({ phase: "planned", runId: "cli-run" });
  const inspect = invoke("inspect", "--qa-root", root, "--run-id", "cli-run");
  expect(inspect.status).toBe(0);
  expect(JSON.parse(inspect.stdout)).toHaveProperty("journeyKey", "google-tracking-launch");
});

it("documents every accepted checkpoint ref name in the loop:state usage", async () => {
  const { RUN_REF_NAMES } = await import("../../src/loop/state");
  const cwd = path.resolve(import.meta.dirname, "../..");
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/loop-state.ts"], { cwd, encoding: "utf8" });
  for (const name of RUN_REF_NAMES) expect(result.stderr, name).toContain(name);
  expect(result.stderr).toContain("[<surface>/]<feature>/runs/ID");
});
