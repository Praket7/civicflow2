import { useCallback, useEffect, useState } from "react";
import { isTauri } from "../platform";
import {
  desktopSyncSnapshot,
  startDesktopSync,
  subscribeDesktopSync,
  syncDesktopNow,
  type DesktopSyncState,
} from "./desktop";
import { readReplicaEntities } from "./desktopStore";

export type SharedRow = Record<string, unknown> & { id: string };

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
  const [sync, setSync] = useState<DesktopSyncState>(() => desktopSyncSnapshot());
  const [data, setData] = useState<SharedReplicaData>(EMPTY);
  // The browser has no SQLite replica, so it is never waiting for one.
  const [loading, setLoading] = useState(() => isTauri());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeDesktopSync(setSync), []);

  useEffect(() => {
    if (!isTauri()) return;
    void startDesktopSync();
  }, []);

  const load = useCallback(async () => {
    const organizationId = desktopSyncSnapshot().organizationId;
    if (!isTauri() || !organizationId) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    try {
      setData(await readAll(organizationId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A pull changes the cursor; a bootstrap changes the entity count. Either
    // means the rows on screen are older than the replica. The microtask keeps
    // the state update out of the effect body, where React can batch it with
    // the render that scheduled it.
    let current = true;
    void (async () => {
      await Promise.resolve();
      if (current) await load();
    })();
    return () => {
      current = false;
    };
  }, [load, sync.organizationId, sync.cursor, sync.entities]);

  const reload = useCallback(async () => {
    setLoading(true);
    // A screen opened while the network was down has no engine yet. Asking to
    // sync also retries that connection; the queue is sent in order after it.
    await startDesktopSync().catch(() => {});
    await syncDesktopNow().catch(() => {});
    await load();
  }, [load]);

  const rebuild = useCallback(async () => {
    setLoading(true);
    await startDesktopSync(true);
    await load();
  }, [load]);

  return { sync, data, loading, error, reload, rebuild };
}

export function rowsById(rows: SharedRow[]): Map<string, SharedRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

export function text(row: SharedRow | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

export function number(row: SharedRow | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === "number" ? value : Number(value) || 0;
}

export function boolean(row: SharedRow | undefined, key: string): boolean {
  return row?.[key] === true;
}
