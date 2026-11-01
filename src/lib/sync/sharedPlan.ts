import type { SharedReplicaData } from "./sharedReplica";
import { number, text, type SharedRow } from "./sharedRows";
import type { SharedAssignment } from "./writes";

/**
 * The desktop's plan is deterministic and local. It reads the replica, never
 * the network, and produces assignments for APPLY_ROSTER_PLAN. The server
 * still checks capacity, overlap, lock and membership before writing, so a
 * plan built from a stale copy is refused as a whole rather than half-applied.
 */

interface Candidate {
  volunteerId: string;
  score: number;
  waitlisted: boolean;
}

function activeRegistration(row: SharedRow): boolean {
  return ["registered", "confirmed"].includes(text(row, "status"));
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const start = new Date(aStart).getTime();
  const end = new Date(aEnd).getTime();
  const otherStart = new Date(bStart).getTime();
  const otherEnd = new Date(bEnd).getTime();
  if ([start, end, otherStart, otherEnd].some(Number.isNaN)) return false;
  return start < otherEnd && end > otherStart;
}

export interface PlanOptions {
  /** The instant a recovery plan is built from. Tests pin it. */
  now?: Date;
  /** Only plan shifts starting after this many minutes. */
  leadMinutes?: number;
}

export interface RecoveryPlan {
  assignments: SharedAssignment[];
  shifts: number;
  openSeats: number;
  unfilledSeats: number;
}

function candidatesFor(
  data: SharedReplicaData,
  shift: SharedRow,
  role: string,
  booked: Set<string>,
  planned: SharedAssignment[],
): Candidate[] {
  const requirement = data.roleRequirements.find(
    (row) => text(row, "shift_id") === shift.id && text(row, "role_name") === role,
  );
  const wantedSkill = text(requirement ?? undefined, "skill").toLowerCase();
  const roleSkill = role.toLowerCase();

  const waitlisted = new Map<string, number>();
  for (const entry of data.waitlists) {
    if (text(entry, "shift_id") !== shift.id) continue;
    if (text(entry, "status") !== "waiting") continue;
    const eligible = text(entry, "eligible_role");
    if (eligible !== "" && eligible !== role) continue;
    waitlisted.set(text(entry, "volunteer_id"), number(entry, "position"));
  }

  const shiftsById = new Map(data.shifts.map((row) => [row.id, row]));
  const load = new Map<string, number>();
  for (const registration of data.registrations) {
    if (!activeRegistration(registration)) continue;
    const volunteerId = text(registration, "volunteer_id");
    load.set(volunteerId, (load.get(volunteerId) ?? 0) + 1);
  }

  return data.volunteers
    .filter((volunteer) => text(volunteer, "status") !== "inactive")
    .filter((volunteer) => !booked.has(volunteer.id))
    .filter((volunteer) => !waitlisted.has(volunteer.id) || text(volunteer, "status") === "active")
    .map((volunteer) => {
      const skills = new Set(
        data.volunteerSkills
          .filter((skill) => text(skill, "volunteer_id") === volunteer.id)
          .map((skill) => text(skill, "skill").toLowerCase()),
      );
      const busy = data.registrations.some((registration) => {
        if (!activeRegistration(registration)) return false;
        if (text(registration, "volunteer_id") !== volunteer.id) return false;
        const other = shiftsById.get(text(registration, "shift_id"));
        if (!other || other.id === shift.id) return false;
        return overlaps(
          text(shift, "starts_at"),
          text(shift, "ends_at"),
          text(other, "starts_at"),
          text(other, "ends_at"),
        );
      });
      if (busy) return null;

      // A volunteer may work two shifts in a week, just never two that overlap.
      const plannedBusy = planned.some((assignment) => {
        if (assignment.volunteerId !== volunteer.id) return false;
        const other = shiftsById.get(assignment.shiftId);
        if (!other) return false;
        return overlaps(
          text(shift, "starts_at"),
          text(shift, "ends_at"),
          text(other, "starts_at"),
          text(other, "ends_at"),
        );
      });
      if (plannedBusy) return null;

      // A waitlisted person is next in line for their own shift, so they win
      // the tie before any skill bonus. Everything else is stable arithmetic;
      // no clock or random value can reorder two equally good candidates.
      const waitPosition = waitlisted.get(volunteer.id);
      const score =
        (waitPosition !== undefined ? 100 - waitPosition : 0) +
        (wantedSkill !== "" && skills.has(wantedSkill) ? 5 : 0) +
        (skills.has(roleSkill) ? 3 : 0) -
        (load.get(volunteer.id) ?? 0) * 0.5;
      return { volunteerId: volunteer.id, score, waitlisted: waitPosition !== undefined };
    })
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.waitlisted) - Number(a.waitlisted) ||
        a.volunteerId.localeCompare(b.volunteerId),
    );
}

/** Open role seats for one shift, after counting live registrations. */
function openSlots(data: SharedReplicaData, shift: SharedRow): { role: string; seats: number }[] {
  const live = data.registrations.filter(
    (row) => text(row, "shift_id") === shift.id && activeRegistration(row),
  );
  const roles = data.shiftRoles.filter((row) => text(row, "shift_id") === shift.id);
  const capacity = Math.max(1, number(shift, "capacity"));
  let remaining = Math.max(0, capacity - live.length);
  if (remaining === 0) return [];

  if (roles.length === 0) {
    return [{ role: "General", seats: remaining }];
  }

  const slots: { role: string; seats: number }[] = [];
  for (const role of roles) {
    const name = text(role, "name");
    if (name === "") continue;
    const filled = live.filter((row) => text(row, "role") === name).length;
    const seats = Math.min(
      remaining,
      Math.max(0, Math.min(number(role, "required"), capacity) - filled),
    );
    if (seats > 0) {
      slots.push({ role: name, seats });
      remaining -= seats;
    }
  }
  return slots;
}

/**
 * One shift's plan. Existing registrations are never moved: a recovery plan
 * fills the open seats and leaves the people already booked alone.
 */
export function planShift(data: SharedReplicaData, shiftId: string): SharedAssignment[] {
  const shift = data.shifts.find((row) => row.id === shiftId);
  if (!shift) return [];
  if (text(shift, "status") === "canceled") return [];

  const booked = new Set(
    data.registrations
      .filter((row) => text(row, "shift_id") === shift.id && activeRegistration(row))
      .map((row) => text(row, "volunteer_id")),
  );
  const assignments: SharedAssignment[] = [];
  for (const slot of openSlots(data, shift)) {
    const candidates = candidatesFor(data, shift, slot.role, booked, assignments);
    for (const candidate of candidates.slice(0, slot.seats)) {
      booked.add(candidate.volunteerId);
      assignments.push({ shiftId: shift.id, volunteerId: candidate.volunteerId, role: slot.role });
    }
  }
  return assignments;
}

/**
 * A rescue plan over every shift that still has a gap. Shifts are visited in
 * chronological order and a volunteer is never double-booked into overlapping
 * shifts in the same plan.
 */
export function planUpcoming(data: SharedReplicaData, options: PlanOptions = {}): RecoveryPlan {
  const now = options.now ?? new Date();
  const lead = (options.leadMinutes ?? 15) * 60_000;
  const cutoff = now.getTime() + lead;
  const upcoming = [...data.shifts]
    .filter((shift) => text(shift, "status") !== "canceled")
    .filter((shift) => {
      const starts = new Date(text(shift, "starts_at")).getTime();
      return !Number.isNaN(starts) && starts > cutoff;
    })
    .sort((a, b) => text(a, "starts_at").localeCompare(text(b, "starts_at")));

  const assignments: SharedAssignment[] = [];
  let openSeats = 0;
  let unfilledSeats = 0;

  for (const shift of upcoming) {
    const slots = openSlots(data, shift);
    const before = slots.reduce((total, slot) => total + slot.seats, 0);
    openSeats += before;

    const booked = new Set<string>();
    const shiftAssignments: SharedAssignment[] = [];
    for (const slot of slots) {
      if (
        new Set(shiftAssignments.map((row) => row.volunteerId)).size >=
        Math.max(1, number(shift, "capacity"))
      ) {
        break;
      }
      const candidates = candidatesFor(data, shift, slot.role, booked, [
        ...assignments,
        ...shiftAssignments,
      ]);
      for (const candidate of candidates.slice(0, slot.seats)) {
        booked.add(candidate.volunteerId);
        shiftAssignments.push({
          shiftId: shift.id,
          volunteerId: candidate.volunteerId,
          role: slot.role,
        });
      }
    }

    assignments.push(...shiftAssignments);
    unfilledSeats += Math.max(0, before - shiftAssignments.length);
  }

  return { assignments, shifts: upcoming.length, openSeats, unfilledSeats };
}
