import { useCallback, useEffect, useState } from "react";
import { isTauri } from "../platform";
import {
  desktopSyncSnapshot,
  startDesktopSync,
  subscribeDesktopSync,
  syncDesktopNow,
  type DesktopSyncState,
} from "./desktop";
import { messageOf } from "../errors";

/**
 * The one lifecycle every screen reads the desktop replica through: follow the
 * sync state, start the engine, reload whenever a pull advances the cursor,
 * and expose an explicit retry. A screen supplies the empty value and the
 * local reader; it never talks to Supabase itself.
 *
 * `empty` and `read` must be stable (module constants or functions), because
 * they are dependencies of the load effect.
 */
export interface ReplicaSource<T> {
  sync: DesktopSyncState;
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  rebuild: () => Promise<void>;
}

export function useReplicaSource<T>(
  empty: T,
  read: (organizationId: string) => Promise<T>,
): ReplicaSource<T> {
  const [sync, setSync] = useState<DesktopSyncState>(() => desktopSyncSnapshot());
  const [data, setData] = useState<T>(empty);
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
      setData(empty);
      setLoading(false);
      return;
    }
    try {
      setData(await read(organizationId));
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, [empty, read]);

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
