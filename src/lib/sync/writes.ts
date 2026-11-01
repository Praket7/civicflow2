import { invoke } from "@tauri-apps/api/core";
import type { CommandType } from "./protocol";
import {
  desktopSyncSnapshot,
  startDesktopSync,
  syncDesktopNow,
  type DesktopSyncState,
} from "./desktop";

/**
 * Coordinator writes through the shared organization.
 *
 * The screen names the intent, never the authority. Rust reads the account,
 * replica id, membership epoch and workspace revision from the configured
 * workspace, builds the envelope and stores it in the outbox in one step. The
 * same SyncEngine as the volunteer app uploads it; a refusal lands in the
 * conflict center rather than being retried forever.
 */

export interface SharedEntity {
  id: string;
  row_version?: number;
  [key: string]: unknown;
}

export interface SharedConflict {
  id: string;
  operationId: string | null;
  command: string | null;
  entityType: string;
  entityId: string;
  code: string;
  message: string;
  localPayload: Record<string, unknown> | null;
  authoritative: Record<string, unknown> | null;
  classification: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  resolvedAt: string | null;
}

export function sharedContext(): DesktopSyncState {
  return desktopSyncSnapshot();
}

export function rowVersion(row: SharedEntity | null | undefined): number | null {
  return typeof row?.row_version === "number" ? row.row_version : null;
}

function requireOrganization(): string {
  const state = desktopSyncSnapshot();
  if (!state.organizationId) {
    throw new Error("Open the synced copy before changing the organization.");
  }
  return state.organizationId;
}

async function enqueue(
  command: CommandType,
  payload: Record<string, unknown>,
  entityVersions: Record<string, number> = {},
  baseRevision?: number,
  flush = true,
): Promise<number> {
  const organizationId = requireOrganization();
  const id = await invoke<number>("sync_enqueue_command", {
    organizationId,
    command,
    payload,
    entityVersions,
    baseRevision,
  });
  if (!flush) return id;
  // Best effort: a device that started offline has no engine yet, so opening
  // the connection is part of sending. The row stays queued if this fails.
  await startDesktopSync().catch(() => {});
  await syncDesktopNow().catch(() => {});
  return id;
}

export interface OpportunityInput {
  /** A caller publishing a known row can keep its identity. */
  id?: string;
  title: string;
  cause?: string;
  description?: string;
  address?: string;
  coordinator?: string;
  capacity?: number;
  duration?: string;
  impactMetric?: string;
  training?: string[];
  requirements?: string[];
}

export async function createSharedOpportunity(
  input: OpportunityInput,
  flush = true,
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  await enqueue(
    "CREATE_OPPORTUNITY",
    {
      id,
      title: input.title.trim(),
      cause: input.cause ?? "",
      description: input.description ?? "",
      address: input.address ?? "",
      coordinator: input.coordinator ?? "",
      capacity: Math.max(1, Math.trunc(input.capacity ?? 1)),
      duration: input.duration ?? "",
      impactMetric: input.impactMetric ?? "",
      training: input.training ?? [],
      requirements: input.requirements ?? [],
    },
    {},
    undefined,
    flush,
  );
  return id;
}

export async function updateSharedOpportunity(
  opportunity: SharedEntity,
  patch: Partial<OpportunityInput>,
): Promise<void> {
  const version = rowVersion(opportunity);
  await enqueue(
    "UPDATE_OPPORTUNITY",
    { id: opportunity.id, ...patch },
    versionPayload(opportunity, version),
  );
}

function versionPayload(
  row: SharedEntity,
  version: number | null,
  entity = "opportunity",
): Record<string, number> {
  return version === null ? {} : { [`${entity}:${row.id}`]: version };
}

export interface ShiftInput {
  /** A caller publishing a known row can keep its identity. */
  id?: string;
  opportunityId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  roles?: { name: string; required: number }[];
}

export async function createSharedShift(input: ShiftInput, flush = true): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  await enqueue(
    "CREATE_SHIFT",
    {
      id,
      opportunityId: input.opportunityId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: Math.max(1, Math.trunc(input.capacity)),
      roles: (input.roles ?? [])
        .map((role) => ({
          name: role.name.trim(),
          required: Math.max(0, Math.trunc(role.required)),
        }))
        .filter((role) => role.name !== ""),
    },
    {},
    undefined,
    flush,
  );
  return id;
}

export interface SharedSeriesInput {
  opportunityId: string;
  /** "YYYY-MM-DD" in this computer's clock. */
  startsOn: string;
  /** "HH:MM" in this computer's clock. */
  startsTime: string;
  durationMinutes: number;
  capacity: number;
  roles: { name: string; required: number }[];
  occurrenceCount: number;
  intervalWeeks?: number;
}

export interface SharedOccurrence {
  date: string;
  startsAt: string;
  endsAt: string;
}

function localDay(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The same calendar arithmetic the desktop uses for a local series. It runs in
 * this computer's clock so a weekly 09:00 shift stays at 09:00 across a DST
 * change, then the instants are sent as absolute ISO timestamps.
 */
export function seriesOccurrences(input: SharedSeriesInput): SharedOccurrence[] {
  const count = Math.max(1, Math.min(60, Math.trunc(input.occurrenceCount)));
  const interval = Math.max(1, Math.min(8, Math.trunc(input.intervalWeeks ?? 1)));
  const first = new Date(`${input.startsOn}T${input.startsTime}:00`);
  if (Number.isNaN(first.getTime())) {
    throw new Error("Enter a valid first day and start time.");
  }
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 15) {
    throw new Error("An occurrence needs at least fifteen minutes.");
  }

  const occurrences: SharedOccurrence[] = [];
  for (let index = 0; index < count; index += 1) {
    const starts = new Date(first);
    starts.setDate(first.getDate() + index * interval * 7);
    const ends = new Date(starts.getTime() + input.durationMinutes * 60_000);
    occurrences.push({
      date: localDay(starts),
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
    });
  }
  return occurrences;
}

export async function createSharedSeries(input: SharedSeriesInput): Promise<string> {
  const id = crypto.randomUUID();
  const intervalWeeks = Math.max(1, Math.min(8, Math.trunc(input.intervalWeeks ?? 1)));
  const occurrences = seriesOccurrences({ ...input, intervalWeeks });
  const first = new Date(`${input.startsOn}T${input.startsTime}:00`);
  await enqueue("CREATE_SHIFT_SERIES", {
    id,
    opportunityId: input.opportunityId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    capacity: Math.max(1, Math.trunc(input.capacity)),
    roles: input.roles
      .map((role) => ({
        name: role.name.trim(),
        required: Math.max(0, Math.trunc(role.required)),
      }))
      .filter((role) => role.name !== ""),
    recurrence: {
      kind: "weekly",
      intervalWeeks,
      weekdays: [first.getDay()],
      startsLocalTime: input.startsTime,
      durationMinutes: Math.trunc(input.durationMinutes),
      startsOn: input.startsOn,
      occurrenceCount: occurrences.length,
    },
    occurrences,
  });
  return id;
}

export interface VolunteerPatch {
  name?: string;
  firstName?: string;
  initials?: string;
  email?: string;
  phone?: string;
  role?: string;
  status?: "active" | "onboarding" | "inactive";
  interests?: string;
  languages?: string[];
  causes?: string[];
}

/**
 * The profile command edits the descriptive record; membership and roster
 * authority stay in their own tables. A coordinator editing someone else names
 * the volunteer, and the server checks that the row is in this organization.
 */
export async function saveSharedVolunteer(
  volunteer: SharedEntity,
  patch: VolunteerPatch,
): Promise<void> {
  const version = rowVersion(volunteer);
  await enqueue(
    "SAVE_VOLUNTEER_PROFILE",
    { volunteerId: volunteer.id, ...patch },
    versionPayload(volunteer, version, "volunteer"),
  );
}

/**
 * Skills are a set, not a record. Sending the whole list makes a retry safe:
 * the server replaces the set rather than appending a second copy of it.
 */
export async function setSharedVolunteerSkills(
  volunteerId: string,
  skills: string[],
): Promise<void> {
  await enqueue("SET_VOLUNTEER_SKILLS", { volunteerId, skills });
}

export type AvailabilityDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type AvailabilityPeriod = "morning" | "afternoon" | "evening";

export interface AvailabilitySlot {
  day: AvailabilityDay;
  period: AvailabilityPeriod;
}

export async function setSharedVolunteerAvailability(
  volunteerId: string,
  slots: AvailabilitySlot[],
): Promise<void> {
  await enqueue("SET_VOLUNTEER_AVAILABILITY", { volunteerId, slots });
}

export async function createSharedCredentialType(
  name: string,
  validityMonths: number,
): Promise<string> {
  const id = crypto.randomUUID();
  await enqueue("CREATE_CREDENTIAL_TYPE", {
    id,
    name: name.trim(),
    validityMonths: Math.max(1, Math.min(120, Math.trunc(validityMonths))),
  });
  return id;
}

export interface CredentialInput {
  credentialTypeId: string;
  identifier?: string;
  issuedAt?: string;
  validFrom?: string;
  validThrough: string;
  notes?: string;
  verified?: boolean;
}

export async function saveSharedCredential(
  volunteerId: string,
  credential: SharedEntity | null,
  input: CredentialInput,
): Promise<void> {
  const payload: Record<string, unknown> = { volunteerId, ...input };
  if (credential) payload.id = credential.id;
  await enqueue(
    "UPDATE_CREDENTIAL",
    payload,
    credential ? versionPayload(credential, rowVersion(credential), "credential") : {},
  );
}

export async function updateSharedShift(
  shift: SharedEntity,
  patch: {
    startsAt?: string;
    endsAt?: string;
    capacity?: number;
    status?: string;
    roles?: { name: string; required: number }[];
  },
): Promise<void> {
  const version = rowVersion(shift);
  await enqueue(
    "UPDATE_SHIFT",
    { id: shift.id, ...patch },
    versionPayload(shift, version, "shift"),
  );
}

export async function checkInShared(shiftId: string, volunteerId: string): Promise<void> {
  await enqueue("CHECK_IN", {
    shiftId,
    volunteerId,
    clientAt: new Date().toISOString(),
  });
}

export async function checkOutShared(shiftId: string, volunteerId: string): Promise<void> {
  await enqueue("CHECK_OUT", {
    shiftId,
    volunteerId,
    clientAt: new Date().toISOString(),
  });
}

export async function markNoShowShared(
  shiftId: string,
  volunteerId: string,
  note = "",
): Promise<void> {
  await enqueue("MARK_NO_SHOW", { shiftId, volunteerId, note });
}

export async function reviewSharedHours(
  hourEntry: SharedEntity,
  decision: "verified" | "rejected" | "pending",
  approvedMinutes?: number,
  reason?: string,
): Promise<void> {
  await enqueue(
    "REVIEW_HOURS",
    {
      hourEntryId: hourEntry.id,
      status: decision,
      approvedMinutes,
      reason,
    },
    versionPayload(hourEntry, rowVersion(hourEntry), "hour_entry"),
  );
}

export interface SharedAssignment {
  shiftId: string;
  volunteerId: string;
  role: string;
}

export async function applySharedRosterPlan(assignments: SharedAssignment[]): Promise<void> {
  const revision = desktopSyncSnapshot().revision;
  await enqueue("APPLY_ROSTER_PLAN", { assignments }, {}, revision);
}

export async function cancelSharedRegistration(
  shiftId: string,
  volunteerId: string,
  reason = "Canceled by a coordinator",
): Promise<void> {
  await enqueue("CANCEL_REGISTRATION", { shiftId, volunteerId, reason });
}

export async function joinSharedWaitlist(
  shiftId: string,
  volunteerId: string,
  role: string,
): Promise<void> {
  await enqueue("JOIN_WAITLIST", { shiftId, volunteerId, role });
}

export async function listSharedConflicts(): Promise<SharedConflict[]> {
  const organizationId = requireOrganization();
  return invoke<SharedConflict[]>("sync_list_conflicts", { organizationId });
}

export async function resolveSharedConflict(
  conflictId: string,
  resolution: "resolved" | "dismissed",
): Promise<void> {
  const organizationId = requireOrganization();
  await invoke("sync_resolve_conflict", { organizationId, conflictId, resolution });
}
