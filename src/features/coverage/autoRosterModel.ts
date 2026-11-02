import type { ShiftRow } from "../../lib/workspace/selectors";
import type { Volunteer } from "../../types/domain";

export interface RoleGap {
  name: string;
  required: number;
  filled: number;
  missing: number;
}

export type AvailabilityState = "available" | "partial" | "unknown" | "unavailable";

export interface Candidate {
  volunteer: Volunteer;
  primaryRole: string;
  eligibleRoles: string[];
  score: number;
  scores: Record<string, number>;
  breakdown: { label: string; value: number; max: number }[];
  reasons: string[];
  availability: AvailabilityState;
  weeklyShifts: number;
  conflict: string | null;
  waitlisted: boolean;
}

export interface ShiftPlan {
  row: ShiftRow;
  gaps: RoleGap[];
  required: number;
  filled: number;
  rosterCount: number;
  filledByRole: Map<string, number>;
}

export interface PlanRow {
  shiftId: string;
  shiftTitle: string;
  startsAt: string;
  gap: RoleGap;
  candidate: Candidate;
  backend: import("../../types/domain").RosterPlan["assignments"][number];
}

export interface EngineOptions {
  preferSpanish: boolean;
  includeWaitlist: boolean;
  blockConflicts: boolean;
  capWeekly: boolean;
}

export const DEFAULT_OPTIONS: EngineOptions = {
  preferSpanish: true,
  includeWaitlist: true,
  blockConflicts: true,
  capWeekly: false,
};

export const ROLE_COLORS = [
  "var(--color-red)",
  "var(--color-orange)",
  "var(--color-green)",
  "var(--color-cobalt)",
  "var(--color-violet)",
];

export const AVAILABILITY_POINTS = 25;

export function availabilityLabel(state: AvailabilityState): string {
  if (state === "available") return "Available for this shift";
  if (state === "partial") return "Partial availability this day";
  if (state === "unknown") return "Availability not confirmed";
  return "No availability listed for this day";
}
