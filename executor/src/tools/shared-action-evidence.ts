import path from "node:path";

import { driftNextStep } from "./action-failure";
import { assertWritableCaseId, isNonCasePhase, NON_CASE_PHASES } from "./action-index";
import type { RollbackLevel } from "./action-table";

export type SharedActionEvidenceStatus = "completed" | "failed" | "action_unknown";

/** The CLI must fail whenever the final evidence is not a completed Action. */
export function sharedActionExitCode(status: SharedActionEvidenceStatus): 0 | 1 {
  return status === "completed" ? 0 : 1;
}

/**
 * A read Action that fails changed nothing, so it is a plain failure. Any
 * other Action that fails, times out or loses its after-capture may already
 * have taken effect: its outcome is unknown until the live state is read.
 */
export function sharedActionFailureStatus(rollback: RollbackLevel): "failed" | "action_unknown" {
  return rollback === "read" ? "failed" : "action_unknown";
}

export async function finalizeSharedActionEvidence(
  rollback: RollbackLevel,
  actionError: string | null,
  captureAfter: () => Promise<void>
): Promise<{
  status: SharedActionEvidenceStatus;
  error: string | null;
  afterCaptured: boolean;
}> {
  let afterCaptured = false;
  try {
    await captureAfter();
    afterCaptured = true;
  } catch {
    actionError ??= "After-action evidence capture failed; inspect the live state before retry";
  }
  return {
    status: actionError ? sharedActionFailureStatus(rollback) : "completed",
    error: actionError,
    afterCaptured,
  };
}

/** What the operator does next, printed with the result; null when nothing is pending. */
export function sharedActionNextStep(
  status: SharedActionEvidenceStatus,
  rollback: RollbackLevel,
  undoneBy: string | null,
  driftAction: string | null = null
): string | null {
  if (status === "completed") return null;
  const drift = driftAction ? ` ${driftNextStep(driftAction)}` : "";
  if (status === "failed") {
    return driftAction
      ? `The read-only Action changed nothing.${drift}`
      : "The read-only Action changed nothing; fix the precondition and retry it.";
  }
  return `${unknownNextStep(rollback, undoneBy)}${drift}`;
}

function unknownNextStep(rollback: RollbackLevel, undoneBy: string | null): string {
  const check = "Outcome unknown: read the live state with a read-only Action before anything else, and do not re-send this Action blindly.";
  if (rollback === "irreversible") return `${check} It is irreversible; if it took effect, record that and continue from there.`;
  return undoneBy
    ? `${check} If it took effect and must be undone, run ${undoneBy}.`
    : `${check} If it took effect, the table names no undo Action; see its undoNote.`;
}

/** A JSON-printable refusal of an Action call's Case identity. */
export class InvocationIdentityError extends Error {
  constructor(message: string, readonly value: string | null) {
    super(message);
    this.name = "InvocationIdentityError";
  }

  toJSON() {
    return {
      error: "invalid_case_id", message: this.message, value: this.value,
      allowed: ["case-<N>", "<Case key>", ...NON_CASE_PHASES.map((phase) => `--phase ${phase}`)],
      nextStep: "Pass --case-id case-<N> for a Case step, or --phase setup (sign-in / preparation) / " +
        "--phase cleanup (closeout) for calls that belong to no Case.",
    };
  }
}

/**
 * The Case identity an e2b:action call is logged under: `--phase setup|cleanup`
 * for calls outside any Case, else `--case-id`, else the case directory name.
 * A directory such as `_prep` is not an identity: say which flag to use.
 */
export function resolveInvocationCaseId(input: { caseDir: string; caseId?: string; phase?: string }): string {
  if (input.phase !== undefined) {
    if (!isNonCasePhase(input.phase)) {
      throw new InvocationIdentityError(`--phase must be setup or cleanup, not "${input.phase}"`, input.phase);
    }
    if (input.caseId !== undefined && input.caseId !== input.phase) {
      throw new InvocationIdentityError(
        `A call is either --phase ${input.phase} or a Case (--case-id ${input.caseId}), not both`, input.caseId);
    }
    return input.phase;
  }
  const caseId = input.caseId ?? path.basename(path.resolve(input.caseDir));
  try {
    assertWritableCaseId(caseId);
  } catch (error) {
    throw new InvocationIdentityError(error instanceof Error ? error.message : String(error), caseId);
  }
  return caseId;
}

/**
 * Which reuse event a finished call writes: a hit for a clean run; a
 * pending_crosscheck when the read's silent-drift guard fired (settled later by
 * `action:reuse confirm`); nothing for a failure or a drift-verify rerun.
 */
export function invocationReuseOutcome(input: {
  status: SharedActionEvidenceStatus; verifyOnly: boolean; crossCheck: boolean;
}): "hit" | "pending_crosscheck" | null {
  if (input.status !== "completed" || input.verifyOnly) return null;
  return input.crossCheck ? "pending_crosscheck" : "hit";
}
