import { invoke } from "@tauri-apps/api/core";
import type { CandidateAnswer, RosterEvaluation, RosterOptions } from "../../types/domain";

/** Defaults match the local AutoRoster screen; the shared panel exposes the same four choices. */
export const SHARED_ROSTER_OPTIONS: RosterOptions = {
  preferSpanish: true,
  includeWaitlist: true,
  blockConflicts: true,
  capWeekly: false,
};

/**
 * The native replica is translated into the same candidate and slot types the
 * local solver consumes. This command is the shared screen's only planner.
 */
export async function evaluateSharedRoster(
  organizationId: string,
  shiftIds: string[],
  options: RosterOptions = SHARED_ROSTER_OPTIONS,
): Promise<RosterEvaluation> {
  return invoke<RosterEvaluation>("shared_evaluate_roster", {
    organizationId,
    shiftIds,
    options,
  });
}

export async function explainSharedRoster(
  organizationId: string,
  shiftIds: string[],
  candidateId: string,
  slotId: string,
  options: RosterOptions = SHARED_ROSTER_OPTIONS,
): Promise<CandidateAnswer> {
  return invoke<CandidateAnswer>("shared_explain_roster", {
    organizationId,
    shiftIds,
    options,
    candidateId,
    slotId,
  });
}
