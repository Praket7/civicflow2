import { invoke } from "@tauri-apps/api/core";
import type { CandidateAnswer, RosterEvaluation, RosterOptions } from "../../types/domain";

/** The shared screen has no options panel yet; these match AutoRoster's defaults. */
export const SHARED_ROSTER_OPTIONS: RosterOptions = {
  preferSpanish: false,
  blockConflicts: true,
  capWeekly: false,
  includeWaitlist: false,
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
