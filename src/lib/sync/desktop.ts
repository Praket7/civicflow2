import type { SupabaseClient } from "@supabase/supabase-js";
import { cloudClient, cloudSession, cloudWorkspaces, registerThisDesktop } from "../cloud/client";
import { desktopDevice } from "../cloud/device";
import { isTauri } from "../platform";
import { readWorkspace } from "./db";
import {
  applyBootstrap,
  configureReplica,
  listReplicaWorkspaces,
  readReplicaEntities,
  replicaStatus,
  type ReplicaStatus,
  TauriSyncStore,
} from "./desktopStore";
import { SyncEngine, type SyncStatus } from "./engine";
import { createSupabaseTransport } from "./transport";

/**
 * The desktop's own shared workspace.
 *
 * The hosted page inside `/shared` remains the full coordinator surface. This
 * runtime proves the desktop can hold the same organization in its encrypted
 * SQLite database: it bootstraps once, then uses the same SyncEngine as the
 * phone, with TauriSyncStore as the durable store. No coordinator screen writes
 * through it yet, so every row here is server-authored.
 */

export type DesktopSyncPhase = "idle" | "starting" | "ready" | "offline" | "error";

export interface DesktopSyncState {
  phase: DesktopSyncPhase;
  organizationId: string | null;
  organizationName: string | null;
  userId: string | null;
  membershipEpoch: number;
  configured: boolean;
  online: boolean;
  cursor: number;
  revision: number;
  entities: number;
  pending: number;
  conflicts: number;
  lastSyncedAt: string | null;
  error: string | null;
}

const INITIAL: DesktopSyncState = {
  phase: "idle",
  organizationId: null,
  organizationName: null,
  userId: null,
  membershipEpoch: 0,
  configured: false,
  online: false,
  cursor: 0,
  revision: 0,
  entities: 0,
  pending: 0,
  conflicts: 0,
  lastSyncedAt: null,
  error: null,
};

type Listener = (state: DesktopSyncState) => void;

let state: DesktopSyncState = INITIAL;
let engine: SyncEngine | null = null;
let active: { organizationId: string; userId: string } | null = null;
let starting: Promise<DesktopSyncState> | null = null;
let unsubscribeEngine: (() => void) | null = null;
const listeners = new Set<Listener>();

function publish(patch: Partial<DesktopSyncState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener(state);
}

export function desktopSyncSnapshot(): DesktopSyncState {
  return state;
}

export function subscribeDesktopSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error("The shared workspace did not answer in time.")),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

async function organizationName(organizationId: string): Promise<string | null> {
  try {
    const rows = await readReplicaEntities(organizationId, "organization", 1);
    const name = rows[0]?.name;
    return typeof name === "string" && name.trim() ? name : null;
  } catch {
    return null;
  }
}

async function mergeReplica(organizationId: string): Promise<ReplicaStatus> {
  const replica = await replicaStatus(organizationId);
  publish({
    configured: replica.configured,
    cursor: replica.cursor,
    revision: replica.revision,
    entities: replica.entities,
    pending: replica.pending,
    conflicts: replica.conflicts,
    lastSyncedAt: replica.lastSyncedAt ?? state.lastSyncedAt,
    membershipEpoch: replica.membershipEpoch || state.membershipEpoch,
    error: replica.lastError ?? state.error,
  });
  return replica;
}

interface HostedWorkspace {
  organizationId: string;
  membershipEpoch: number;
  status: string;
  organization: { name: string };
}

/**
 * Which hosted organization this desktop opens.
 *
 * The remembered workspace (written when the user connected here) wins, then
 * the last replica that actually exists in SQLite, then the only active
 * membership. With more than one organization and nothing remembered, the
 * first active membership is a guess the user can correct in Settings; the
 * screen always names the organization it opened.
 */
export function selectHostedWorkspace(
  workspaces: readonly HostedWorkspace[],
  remembered: string | null,
  local: readonly string[],
): HostedWorkspace | null {
  const active = workspaces.filter((workspace) => workspace.status === "active");
  return (
    active.find((workspace) => workspace.organizationId === remembered) ??
    active.find((workspace) => workspace.organizationId === local[0]) ??
    active[0] ??
    null
  );
}

/** The synced copy to display while signed out or offline. */
export function selectLocalWorkspace(
  remembered: string | null,
  local: readonly string[],
): string | null {
  if (remembered && local.includes(remembered)) return remembered;
  return local[0] ?? null;
}

interface Target {
  organizationId: string;
  userId: string;
  membershipEpoch: number;
  name: string | null;
  client: SupabaseClient | null;
  online: boolean;
}

async function chooseTarget(): Promise<Target> {
  const local = await listReplicaWorkspaces();
  const remembered = await readWorkspace().catch(() => null);
  const session = await withTimeout(cloudSession(), 4_000).catch(() => null);
  const client = cloudClient();

  if (session && client) {
    const workspaces = await withTimeout(cloudWorkspaces(), 6_000).catch(() => []);
    const chosen = selectHostedWorkspace(workspaces, remembered, local);
    if (chosen) {
      return {
        organizationId: chosen.organizationId,
        userId: session.user.id,
        membershipEpoch: chosen.membershipEpoch,
        name: chosen.organization.name,
        client,
        online: true,
      };
    }
  }

  // Offline, or signed out of the hosted provider: the last replica is still
  // readable and still belongs to the account that configured it.
  const organizationId = selectLocalWorkspace(remembered, local);
  if (!organizationId) {
    throw new Error(
      "Connect a shared workspace under Settings first. The desktop has no synced copy to open.",
    );
  }
  const replica = await replicaStatus(organizationId);
  if (!replica.configured || !replica.userId) {
    throw new Error("The synced copy on this desktop is not configured.");
  }
  return {
    organizationId,
    userId: replica.userId,
    membershipEpoch: replica.membershipEpoch,
    name: null,
    client: null,
    online: false,
  };
}

async function bootstrap(target: Target): Promise<void> {
  if (!target.client) return;
  const response = (await withTimeout(
    Promise.resolve(
      target.client.rpc("bootstrap_workspace", { p_organization_id: target.organizationId }),
    ),
    20_000,
  )) as { data?: unknown; error?: { message?: string } | null };
  if (response.error) throw new Error(response.error.message ?? "The bootstrap request failed.");
  if (response.data == null) throw new Error("The server returned no bootstrap snapshot.");
  await applyBootstrap({
    organizationId: target.organizationId,
    userId: target.userId,
    membershipEpoch: target.membershipEpoch,
    payload: response.data,
  });
}

function engineSnapshot(next: SyncStatus): void {
  publish({
    online: next.online,
    revision: next.revision,
    pending: next.pending,
    conflicts: next.conflicts,
    lastSyncedAt: next.lastSyncedAt ?? state.lastSyncedAt,
    error: next.lastError,
    phase: state.phase === "starting" ? "starting" : "ready",
  });
}

async function runStart(forceBootstrap: boolean): Promise<DesktopSyncState> {
  if (!isTauri()) {
    publish({ phase: "error", error: "The synced copy is only available in the desktop app." });
    return state;
  }
  publish({ phase: "starting", error: null });
  try {
    const target = await chooseTarget();
    publish({
      organizationId: target.organizationId,
      userId: target.userId,
      membershipEpoch: target.membershipEpoch,
      organizationName: target.name ?? (await organizationName(target.organizationId)),
      online: target.online,
    });

    // A changed membership epoch means the server may now show this account
    // more or fewer rows. A cursor replay does not remove rows that became
    // invisible, so the replica is rebuilt from current state instead.
    const previous = await replicaStatus(target.organizationId).catch(() => null);
    const authorityChanged = Boolean(
      previous?.configured &&
      previous.userId === target.userId &&
      previous.membershipEpoch !== target.membershipEpoch,
    );

    const configured = await configureReplica({
      organizationId: target.organizationId,
      userId: target.userId,
      membershipEpoch: target.membershipEpoch,
    });
    publish({
      configured: configured.configured,
      cursor: configured.cursor,
      revision: configured.revision,
    });

    if (target.online && target.client) {
      // Health is a report, not a condition of syncing. A refused registration
      // must not keep the replica from opening.
      if (configured.replicaId) {
        const device = desktopDevice();
        await registerThisDesktop(
          target.organizationId,
          configured.replicaId,
          device.label,
          device.platform,
        ).catch(() => {});
      }
      // An empty replica, a different account, or an explicit refresh all need
      // current state rather than a cursor replay.
      // A different account is detected inside configureReplica, which clears
      // the replica, so an empty replica also covers a switched account.
      if (
        forceBootstrap ||
        authorityChanged ||
        configured.cursor === 0 ||
        configured.entities === 0
      ) {
        await bootstrap(target);
      }
      await mergeReplica(target.organizationId);
      const name = await organizationName(target.organizationId);
      publish({ organizationName: name ?? target.name });

      if (
        !active ||
        active.organizationId !== target.organizationId ||
        active.userId !== target.userId
      ) {
        engine?.stop();
        unsubscribeEngine?.();
        engine = new SyncEngine({
          store: new TauriSyncStore(),
          transport: createSupabaseTransport(target.client),
          pollMs: 30_000,
        });
        unsubscribeEngine = engine.subscribe((event) => {
          if (event.type === "status") {
            engineSnapshot(event.status);
            if (!event.status.running) void mergeReplica(target.organizationId).catch(() => {});
          }
          if (event.type === "data") void mergeReplica(target.organizationId).catch(() => {});
        });
        active = { organizationId: target.organizationId, userId: target.userId };
      }
      const running = engine;
      if (!running) throw new Error("The shared sync engine did not start.");
      await running.start(target.userId, target.organizationId);
      await mergeReplica(target.organizationId);
      // `start` resolves even when its first pull failed; the engine's own
      // status listener has already recorded that, so do not overwrite it.
      publish({ phase: "ready", organizationName: name ?? target.name });
      return state;
    }

    await mergeReplica(target.organizationId);
    publish({
      phase: "offline",
      online: false,
      organizationName: await organizationName(target.organizationId),
      error:
        state.error ??
        "Showing the synced copy on this computer. Reconnect to receive changes from the organization.",
    });
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publish({ phase: state.configured ? "offline" : "error", online: false, error: message });
    return state;
  }
}

export async function startDesktopSync(forceBootstrap = false): Promise<DesktopSyncState> {
  if (starting) return starting;
  starting = runStart(forceBootstrap).finally(() => {
    starting = null;
  });
  return starting;
}

export async function syncDesktopNow(): Promise<DesktopSyncState> {
  if (active && engine) {
    await engine.syncNow();
    await mergeReplica(active.organizationId);
  }
  return state;
}

export function stopDesktopSync(): void {
  engine?.stop();
  engine = null;
  active = null;
  unsubscribeEngine?.();
  unsubscribeEngine = null;
  publish(INITIAL);
}
