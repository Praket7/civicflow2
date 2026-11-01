import { useCallback, useEffect, useState } from "react";
import { isTauri } from "../platform";
import {
  desktopSyncSnapshot,
  startDesktopSync,
  subscribeDesktopSync,
  syncDesktopNow,
  type DesktopSyncState,
} from "./desktop";
import { readReplicaReportEntities } from "./desktopStore";
import { EMPTY_REPORT_DATA, type SharedReportData } from "./sharedReports";
import type { SharedRow } from "./sharedReplica";

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

export function useSharedReportData(): SharedReportSource {
  const [sync, setSync] = useState<DesktopSyncState>(() => desktopSyncSnapshot());
  const [data, setData] = useState<SharedReportData>(EMPTY_REPORT_DATA);
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
      setData(EMPTY_REPORT_DATA);
      setLoading(false);
      return;
    }
    try {
      setData(reportDataFrom(await readReplicaReportEntities(organizationId)));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
    await startDesktopSync().catch(() => {});
    await syncDesktopNow().catch(() => {});
    await load();
  }, [load]);

  return { sync, data, loading, error, reload };
}
