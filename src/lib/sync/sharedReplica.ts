import type { DesktopSyncState } from "./desktop";
import { readReplicaEntities } from "./desktopStore";
import type { SharedRow } from "./sharedRows";
import { useReplicaSource } from "./useReplicaSource";

export interface SharedReplicaData {
  organization: SharedRow | null;
  opportunities: SharedRow[];
  shifts: SharedRow[];
  shiftRoles: SharedRow[];
  roleRequirements: SharedRow[];
  volunteers: SharedRow[];
  volunteerSkills: SharedRow[];
  availabilityRules: SharedRow[];
  credentialTypes: SharedRow[];
  credentials: SharedRow[];
  registrations: SharedRow[];
  waitlists: SharedRow[];
  attendance: SharedRow[];
  hourEntries: SharedRow[];
  series: SharedRow[];
  seriesRoles: SharedRow[];
}

const EMPTY: SharedReplicaData = {
  organization: null,
  opportunities: [],
  shifts: [],
  shiftRoles: [],
  roleRequirements: [],
  volunteers: [],
  volunteerSkills: [],
  availabilityRules: [],
  credentialTypes: [],
  credentials: [],
  registrations: [],
  waitlists: [],
  attendance: [],
  hourEntries: [],
  series: [],
  seriesRoles: [],
};

async function readAll(organizationId: string): Promise<SharedReplicaData> {
  const [
    organization,
    opportunities,
    shifts,
    shiftRoles,
    roleRequirements,
    volunteers,
    volunteerSkills,
    availabilityRules,
    credentialTypes,
    credentials,
    registrations,
    waitlists,
    attendance,
    hourEntries,
    series,
    seriesRoles,
  ] = await Promise.all([
    readReplicaEntities(organizationId, "organization", 1),
    readReplicaEntities(organizationId, "opportunity", 500),
    readReplicaEntities(organizationId, "shift", 500),
    readReplicaEntities(organizationId, "shift_role", 1000),
    readReplicaEntities(organizationId, "role_requirement", 1000),
    readReplicaEntities(organizationId, "volunteer", 500),
    readReplicaEntities(organizationId, "volunteer_skill", 1000),
    readReplicaEntities(organizationId, "availability_rule", 1000),
    readReplicaEntities(organizationId, "credential_type", 200),
    readReplicaEntities(organizationId, "credential", 1000),
    readReplicaEntities(organizationId, "registration", 1000),
    readReplicaEntities(organizationId, "waitlist_entry", 1000),
    readReplicaEntities(organizationId, "attendance", 1000),
    readReplicaEntities(organizationId, "hour_entry", 500),
    readReplicaEntities(organizationId, "shift_series", 200),
    readReplicaEntities(organizationId, "shift_series_role", 500),
  ]);
  return {
    organization: (organization[0] as SharedRow | undefined) ?? null,
    opportunities: opportunities as SharedRow[],
    shifts: shifts as SharedRow[],
    shiftRoles: shiftRoles as SharedRow[],
    roleRequirements: roleRequirements as SharedRow[],
    volunteers: volunteers as SharedRow[],
    volunteerSkills: volunteerSkills as SharedRow[],
    availabilityRules: availabilityRules as SharedRow[],
    credentialTypes: credentialTypes as SharedRow[],
    credentials: credentials as SharedRow[],
    registrations: registrations as SharedRow[],
    waitlists: waitlists as SharedRow[],
    attendance: attendance as SharedRow[],
    hourEntries: hourEntries as SharedRow[],
    series: series as SharedRow[],
    seriesRoles: seriesRoles as SharedRow[],
  };
}

export interface SharedReplica {
  sync: DesktopSyncState;
  data: SharedReplicaData;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  rebuild: () => Promise<void>;
}

/**
 * Reads the coordinator screens from the SQLite replica. The screen never
 * calls Supabase directly: starting sync, pulling and applying batches stay in
 * the same runtime the volunteer app uses.
 */
export function useSharedReplica(): SharedReplica {
  return useReplicaSource(EMPTY, readAll);
}
