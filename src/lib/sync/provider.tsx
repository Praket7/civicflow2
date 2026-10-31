import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  currentSession,
  displayNameOf,
  ensureProfile,
  myWorkspaces,
  onAuthChange,
  signInWithPassword,
  signOut as providerSignOut,
  supabase,
  type Workspace,
} from "./auth";
import {
  clearVolunteerCache,
  readCursor,
  readWorkspace,
  replicaId,
  volunteerDb,
  writeWorkspace,
} from "./db";
import { SyncEngine, type SyncStatus } from "./engine";
import { DexieSyncStore, queueCommand } from "./localStore";
import { createSupabaseTransport } from "./transport";
import { isTauri } from "../platform";
import { buildVolunteerView, type Row, type VolunteerView } from "./views";
import type { ConflictRow } from "./db";
import type { CommandType } from "./protocol";

type Phase = "loading" | "signed-out" | "ready" | "error";

interface CloudValue {
  phase: Phase;
  session: Session | null;
  workspaces: Workspace[];
  workspace: Workspace | null;
  status: SyncStatus;
  view: VolunteerView | null;
  conflicts: ConflictRow[];
  pendingShiftIds: string[];
  error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  selectWorkspace(organizationId: string): Promise<void>;
  queue(
    command: CommandType,
    payload: Record<string, unknown>,
    entityVersions?: Record<string, number>,
  ): Promise<void>;
  dismissConflict(id: string): Promise<void>;
  retryConflict(conflict: ConflictRow): Promise<void>;
  syncNow(): Promise<void>;
}

const CloudContext = createContext<CloudValue | null>(null);

const EMPTY_STATUS: SyncStatus = {
  organizationId: null,
  running: false,
  online: false,
  pending: 0,
  conflicts: 0,
  lastSyncedAt: null,
  lastError: null,
  revision: 0,
};

/**
 * The cache stores entity types (`shift`), while the view models group them by
 * table (`shifts`). Keeping the mapping explicit stops a typo from quietly
 * rendering an empty screen.
 */
const ROW_SOURCES = {
  volunteers: "volunteer",
  opportunities: "opportunity",
  shifts: "shift",
  roles: "shift_role",
  registrations: "registration",
  waitlist: "waitlist_entry",
  attendance: "attendance",
  hours: "hour_entry",
  credentials: "credential",
  credentialTypes: "credential_type",
  notifications: "notification",
  saved: "saved_opportunity",
} as const;

type RowKey = keyof typeof ROW_SOURCES;

async function readRows(organizationId: string): Promise<Record<RowKey, Row[]>> {
  const rows = {} as Record<RowKey, Row[]>;
  await Promise.all(
    (Object.keys(ROW_SOURCES) as RowKey[]).map(async (key) => {
      const stored = await volunteerDb()
        .entities.where("[organizationId+entity]")
        .equals([organizationId, ROW_SOURCES[key]])
        .toArray();
      rows[key] = stored.map((row) => row.payload);
    }),
  );
  return rows;
}

export function CloudProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<SyncStatus>(EMPTY_STATUS);
  const [view, setView] = useState<VolunteerView | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [pendingShiftIds, setPendingShiftIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const starting = useRef(false);
  const organizationRef = useRef<string | null>(null);
  const lastReport = useRef<string>("");
  const userId = session?.user.id ?? null;

  const engine = useMemo(
    () =>
      new SyncEngine({
        store: new DexieSyncStore(),
        transport: createSupabaseTransport(supabase()),
        pollMs: 20_000,
      }),
    [],
  );

  const loadConflicts = useCallback(async (organizationId: string) => {
    const rows = await volunteerDb()
      .conflicts.where("organizationId")
      .equals(organizationId)
      .filter((row) => row.status === "open")
      .toArray();
    setConflicts(rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  }, []);

  const loadPending = useCallback(async (organizationId: string, owner: string) => {
    // Only this account's queued work is shown or uploaded.
    const rows = await volunteerDb()
      .outbox.where("[userId+organizationId+state]")
      .equals([owner, organizationId, "pending"])
      .toArray();
    const sending = await volunteerDb()
      .outbox.where("[userId+organizationId+state]")
      .equals([owner, organizationId, "sending"])
      .toArray();
    const ids = [...rows, ...sending]
      .map((row) => row.envelope.payload.shiftId)
      .filter((id): id is string => typeof id === "string");
    setPendingShiftIds([...new Set(ids)]);
  }, []);

  const reportDevice = useCallback(
    async (organizationId: string, pending: number, error: string | null) => {
      try {
        const cursor = await readCursor(organizationId);
        await supabase().rpc("report_device_state", {
          p_organization_id: organizationId,
          p_replica_id: await replicaId(),
          p_cursor: cursor,
          p_pending: pending,
          p_oldest_pending_at: null,
          p_error: error,
        });
      } catch {
        // Health is a report, not a write the volunteer depends on.
      }
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = engine.subscribe((event) => {
      if (event.type === "status") {
        setStatus(event.status);
        const current = event.status;
        if (current.organizationId && !current.running) {
          const fingerprint = `${current.organizationId}:${current.pending}:${current.lastError ?? ""}`;
          if (fingerprint !== lastReport.current) {
            lastReport.current = fingerprint;
            void reportDevice(current.organizationId, current.pending, current.lastError);
          }
        }
      }
      if (event.type === "data") setDataVersion((value) => value + 1);
      if (event.type === "conflict") {
        // A refusal arrives outside the data stream, so the list on screen has
        // to be reloaded from the device's own conflict table.
        const organizationId = organizationRef.current;
        if (organizationId) void loadConflicts(organizationId);
      }
    });
    return unsubscribe;
  }, [engine, loadConflicts, reportDevice]);

  const loadView = useCallback(async (current: Workspace) => {
    if (!current.volunteerId) {
      setView(null);
      return;
    }
    const rows = await readRows(current.organizationId);
    setView(
      buildVolunteerView({
        now: new Date().toISOString(),
        volunteerId: current.volunteerId,
        rows: {
          volunteers: rows.volunteers,
          opportunities: rows.opportunities,
          shifts: rows.shifts,
          roles: rows.roles,
          registrations: rows.registrations,
          waitlist: rows.waitlist,
          attendance: rows.attendance,
          hours: rows.hours,
          credentials: rows.credentials,
          credentialTypes: rows.credentialTypes,
          notifications: rows.notifications,
          saved: rows.saved,
        },
      }),
    );
  }, []);

  useEffect(() => {
    if (!workspace) return;
    if (!userId) return;
    let active = true;
    void (async () => {
      await loadPending(workspace.organizationId, userId);
      await loadConflicts(workspace.organizationId);
      if (!active) return;
      await loadView(workspace);
    })();
    return () => {
      active = false;
    };
  }, [workspace, userId, dataVersion, loadConflicts, loadPending, loadView]);

  const openWorkspace = useCallback(
    async (chosen: Workspace, owner: string) => {
      setWorkspace(chosen);
      organizationRef.current = chosen.organizationId;
      await writeWorkspace(chosen.organizationId);

      // A coordinator reads the server's health and delivery state, not a
      // volunteer replica. Pulling every table onto a phone would be a privacy
      // leak with no screen that uses it.
      if (chosen.role !== "volunteer") {
        engine.stop();
        setView(null);
        setPhase("ready");
        setError(null);
        return;
      }

      await engine.start(owner, chosen.organizationId);
      setPhase("ready");
      setError(null);
      // The coordinator's health view is only useful if a device says who it
      // is. This is a label for the report, never an authorization claim.
      try {
        const agent = navigator.userAgent;
        await supabase().rpc("register_device", {
          p_organization_id: chosen.organizationId,
          p_replica_id: await replicaId(),
          p_label: /iPhone|iPad/i.test(agent)
            ? "iPhone"
            : /Android/i.test(agent)
              ? "Android phone"
              : "Browser",
          p_platform: /iPhone|iPad|Mac/i.test(agent)
            ? "iOS or macOS"
            : /Android/i.test(agent)
              ? "Android"
              : "Web",
        });
      } catch {
        // Registration is health metadata; it must not block the shift list.
      }
      // The first pull may have arrived while the screen was still loading.
      setDataVersion((value) => value + 1);
    },
    [engine],
  );

  const bootstrap = useCallback(
    async (next: Session) => {
      if (starting.current) return;
      starting.current = true;
      try {
        setPhase("loading");
        setSession(next);
        try {
          await ensureProfile(displayNameOf(next.user));
        } catch {
          // A profile row is a convenience; membership is what matters.
        }
        const all = await myWorkspaces();
        setWorkspaces(all);
        const active = all.filter((entry) => entry.status === "active");
        if (active.length === 0) {
          setPhase("error");
          setError(
            all.some((entry) => entry.status === "disabled")
              ? "Your access to this organization was disabled. Ask the owner to restore it."
              : "Your invitation has not been accepted yet.",
          );
          return;
        }
        const remembered = await readWorkspace();
        const chosen = active.find((entry) => entry.organizationId === remembered) ?? active[0];
        // A phone is the volunteer experience; the desktop is also where a
        // coordinator watches the shared workspace, so it opens the role it was
        // given instead of turning the page away.
        if (chosen.role !== "volunteer" && !isTauri()) {
          setWorkspace(chosen);
          setPhase("ready");
          setError(
            "This app is the volunteer experience. Coordinators use the CivicFlow desktop app for rosters and reports.",
          );
          return;
        }
        await openWorkspace(chosen, next.user.id);
      } catch (caught) {
        setPhase("error");
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        starting.current = false;
      }
    },
    [openWorkspace],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const existing = await currentSession();
        if (!active) return;
        if (!existing) {
          setPhase("signed-out");
          return;
        }
        await bootstrap(existing);
      } catch (caught) {
        // A build with no hosted configuration, or a provider that cannot be
        // reached, must say so instead of sitting on the splash screen.
        if (!active) return;
        setPhase("error");
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    const unsubscribe = onAuthChange((next) => {
      if (next) {
        if (!organizationRef.current) void bootstrap(next);
        return;
      }
      engine.stop();
      organizationRef.current = null;
      setSession(null);
      setWorkspace(null);
      setWorkspaces([]);
      setView(null);
      setStatus(EMPTY_STATUS);
      setPhase("signed-out");
    });
    return () => {
      active = false;
      unsubscribe();
      engine.stop();
    };
  }, [bootstrap, engine]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const next = await signInWithPassword(email, password);
      await bootstrap(next);
    },
    [bootstrap],
  );

  const signOut = useCallback(async () => {
    await providerSignOut();
    engine.stop();
    organizationRef.current = null;
    await clearVolunteerCache();
    setSession(null);
    setWorkspace(null);
    setWorkspaces([]);
    setView(null);
    setConflicts([]);
    setPendingShiftIds([]);
    setStatus(EMPTY_STATUS);
    setPhase("signed-out");
  }, [engine]);

  const selectWorkspace = useCallback(
    async (organizationId: string) => {
      const chosen = workspaces.find((entry) => entry.organizationId === organizationId);
      if (!chosen) throw new Error("That workspace is not available to this account.");
      if (!userId) throw new Error("Sign in again to open a workspace.");
      await openWorkspace(chosen, userId);
      setDataVersion((value) => value + 1);
    },
    [openWorkspace, userId, workspaces],
  );

  const queue = useCallback(
    async (
      command: CommandType,
      payload: Record<string, unknown>,
      entityVersions: Record<string, number> = {},
    ) => {
      if (!workspace) throw new Error("Open a workspace first.");
      if (!userId) throw new Error("Sign in again to record this change.");
      await queueCommand({
        userId,
        organizationId: workspace.organizationId,
        membershipEpoch: workspace.membershipEpoch,
        command,
        payload,
        entityVersions,
        baseRevision: status.revision,
      });
      await loadPending(workspace.organizationId, userId);
      void engine.wake();
    },
    [engine, loadPending, status.revision, userId, workspace],
  );

  const dismissConflict = useCallback(
    async (id: string) => {
      await volunteerDb().conflicts.update(id, {
        status: "resolved",
        resolvedAt: new Date().toISOString(),
      });
      if (workspace) await loadConflicts(workspace.organizationId);
    },
    [loadConflicts, workspace],
  );

  const retryConflict = useCallback(
    async (conflict: ConflictRow) => {
      if (!workspace || !userId) return;
      await volunteerDb().conflicts.update(conflict.id, {
        status: "resolved",
        resolvedAt: new Date().toISOString(),
      });
      await queueCommand({
        userId,
        organizationId: workspace.organizationId,
        membershipEpoch: workspace.membershipEpoch,
        command: conflict.command as CommandType,
        payload: conflict.localPayload,
        baseRevision: status.revision,
      });
      void engine.wake();
      await loadConflicts(workspace.organizationId);
      await loadPending(workspace.organizationId, userId);
    },
    [engine, loadConflicts, loadPending, status.revision, userId, workspace],
  );

  // A refused command can mean the membership moved. Refresh the epoch so the
  // next attempt carries the truth instead of repeating a stale claim.
  useEffect(() => {
    if (!workspace || conflicts.length === 0) return;
    let active = true;
    void (async () => {
      try {
        const all = await myWorkspaces();
        if (!active) return;
        setWorkspaces(all);
        const current = all.find((entry) => entry.organizationId === workspace.organizationId);
        if (current) setWorkspace(current);
      } catch {
        // Offline: the stored epoch stays until the next successful sync.
      }
    })();
    return () => {
      active = false;
    };
  }, [conflicts, workspace]);

  const syncNow = useCallback(async () => {
    await engine.syncNow();
  }, [engine]);

  const value = useMemo<CloudValue>(
    () => ({
      phase,
      session,
      workspaces,
      workspace,
      status,
      view,
      conflicts,
      pendingShiftIds,
      error,
      signIn,
      signOut,
      selectWorkspace,
      queue,
      dismissConflict,
      retryConflict,
      syncNow,
    }),
    [
      phase,
      session,
      workspaces,
      workspace,
      status,
      view,
      conflicts,
      pendingShiftIds,
      error,
      signIn,
      signOut,
      selectWorkspace,
      queue,
      dismissConflict,
      retryConflict,
      syncNow,
    ],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudValue {
  const value = useContext(CloudContext);
  if (!value) throw new Error("useCloud must be used inside CloudProvider");
  return value;
}
