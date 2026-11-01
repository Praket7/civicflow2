import type { DesktopSyncState } from "./desktop";
import { readReplicaReportEntities } from "./desktopStore";
import { EMPTY_REPORT_DATA, type SharedReportData } from "./sharedReports";
import type { SharedRow } from "./sharedRows";
import { useReplicaSource } from "./useReplicaSource";

/**
 * The reporting read model over the desktop replica.
 *
 * A report is the one coordinator screen that cannot page its input. This hook
 * asks Rust for every live row of the eight report entities in one local query,
 * so a total is computed from the whole replica rather than the newest 500
 * rows. Pulling still goes through the same engine as every other screen.
 */

function toRows(value: Record<string, unknown>[] | undefined): SharedRow[] {
  return (value ?? []) as SharedRow[];
}

export function reportDataFrom(raw: Record<string, Record<string, unknown>[]>): SharedReportData {
  return {
    opportunities: toRows(raw.opportunity),
    shifts: toRows(raw.shift),
    volunteers: toRows(raw.volunteer),
    registrations: toRows(raw.registration),
    attendance: toRows(raw.attendance),
    hourEntries: toRows(raw.hour_entry),
    credentials: toRows(raw.credential),
    credentialTypes: toRows(raw.credential_type),
  };
}

export interface SharedReportSource {
  sync: DesktopSyncState;
  data: SharedReportData;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function readReport(organizationId: string): Promise<SharedReportData> {
  return readReplicaReportEntities(organizationId).then(reportDataFrom);
}

export function useSharedReportData(): SharedReportSource {
  const { sync, data, loading, error, reload } = useReplicaSource(EMPTY_REPORT_DATA, readReport);
  return { sync, data, loading, error, reload };
}
