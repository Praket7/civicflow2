import type { ConflictClass, ConflictRow, OutboxRow } from "./db";
import {
  isAccepted,
  isRetryable,
  isTerminalRefusal,
  type Change,
  type CommandEnvelope,
  type CommandResult,
  type PullResult,
} from "./protocol";

export interface SyncStore {
  recoverStaleSending(cutoff: number, now: number): Promise<number>;
  nextReady(userId: string, organizationId: string, now: number): Promise<OutboxRow | null>;
  markSending(id: number): Promise<void>;
  markSent(id: number, result: CommandResult): Promise<void>;
  markRetry(id: number, error: string, nextAttemptAt: number): Promise<void>;
  markRefused(id: number, result: CommandResult, conflict: ConflictRow): Promise<void>;
  pendingCount(userId: string, organizationId: string): Promise<number>;
  openConflictCount(organizationId: string): Promise<number>;
  readCursor(organizationId: string): Promise<number>;
  applyPull(organizationId: string, changes: Change[], cursor: number): Promise<void>;
  readRevision(organizationId: string): Promise<number>;
  writeRevision(organizationId: string, revision: number): Promise<void>;
}

export interface SyncTransport {
  push(envelope: CommandEnvelope): Promise<CommandResult>;
  pull(organizationId: string, cursor: number, limit: number): Promise<PullResult>;
  subscribe?(organizationId: string, wake: () => void): () => void;
}

export interface SyncStatus {
  organizationId: string | null;
  running: boolean;
  online: boolean;
  pending: number;
  conflicts: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  revision: number;
}

export type SyncEvent =
  | { type: "status"; status: SyncStatus }
  | { type: "data" }
  | { type: "conflict"; conflict: ConflictRow };

type Listener = (event: SyncEvent) => void;

const SENDING_STALE_MS = 2 * 60_000;
const MAX_COMMANDS_PER_PASS = 20;
const MAX_PULL_BATCHES = 20;

/**
 * Deterministic conflict classes from the command, not from the payload.
 * A registration is never merged field by field, no matter what a future
 * caller puts in its payload.
 */
export function conflictClassFor(command: string, code?: string): ConflictClass {
  // An authority refusal is never a field-level merge, whatever the command.
  if (code === "stale_authority" || code === "forbidden") return "invariant";
  switch (command) {
    case "REGISTER_FOR_SHIFT":
    case "CANCEL_REGISTRATION":
    case "JOIN_WAITLIST":
    case "CHECK_IN":
    case "CHECK_OUT":
    case "MARK_NO_SHOW":
    case "APPLY_ROSTER_PLAN":
    case "REVIEW_HOURS":
    case "UPDATE_CREDENTIAL":
      return "invariant";
    case "SAVE_VOLUNTEER_PROFILE":
    case "UPDATE_OPPORTUNITY":
    case "UPDATE_SHIFT":
    case "UPDATE_ROSTER_POLICY":
      return "field";
    default:
      return "field";
  }
}

export function backoffMs(attempts: number, random: () => number): number {
  const base = Math.min(1_000 * 2 ** Math.max(attempts, 0), 60_000);
  return base + Math.floor(random() * 250);
}

interface EngineOptions {
  store: SyncStore;
  transport: SyncTransport;
  now?: () => number;
  random?: () => number;
  /** How often an idle device checks for changes while online. */
  pollMs?: number;
}

export class SyncEngine {
  private readonly store: SyncStore;
  private readonly transport: SyncTransport;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly pollMs: number;
  private readonly listeners = new Set<Listener>();
  private organizationId: string | null = null;
  private userId: string | null = null;
  private revision = 0;
  private timer: number | null = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private flight: Promise<void> | null = null;
  private status: SyncStatus = {
    organizationId: null,
    running: false,
    online: false,
    pending: 0,
    conflicts: 0,
    lastSyncedAt: null,
    lastError: null,
    revision: 0,
  };

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.pollMs = options.pollMs ?? 20_000;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): SyncStatus {
    return { ...this.status };
  }

  private emit(event: SyncEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async publish(patch: Partial<SyncStatus> = {}): Promise<void> {
    if (!this.organizationId) {
      this.status = { ...this.status, ...patch };
      this.emit({ type: "status", status: this.snapshot() });
      return;
    }
    const userId = this.userId;
    if (!userId) {
      this.status = { ...this.status, ...patch, pending: 0, conflicts: 0 };
      this.emit({ type: "status", status: this.snapshot() });
      return;
    }
    const [pending, conflicts] = await Promise.all([
      this.store.pendingCount(userId, this.organizationId),
      this.store.openConflictCount(this.organizationId),
    ]);
    this.status = { ...this.status, ...patch, pending, conflicts };
    this.emit({ type: "status", status: this.snapshot() });
  }

  async start(userId: string, organizationId: string): Promise<void> {
    if (this.userId === userId && this.organizationId === organizationId && this.timer !== null) {
      return;
    }
    this.stop();
    this.userId = userId;
    this.organizationId = organizationId;
    this.revision = await this.store.readRevision(organizationId);
    await this.publish({ organizationId, revision: this.revision });
    this.unsubscribeRealtime =
      this.transport.subscribe?.(organizationId, () => {
        void this.syncNow();
      }) ?? null;
    this.timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void this.syncNow();
    }, this.pollMs);
    await this.syncNow();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.unsubscribeRealtime?.();
    this.unsubscribeRealtime = null;
    this.organizationId = null;
    this.userId = null;
  }

  /** Called after a local write queues a command. */
  async wake(): Promise<void> {
    await this.syncNow();
  }

  /**
   * One pass: recover, upload, pull. Concurrent callers share the same pass so
   * two visibility events cannot upload the same command twice.
   */
  syncNow(): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = this.pass().finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  private async pass(): Promise<void> {
    const organizationId = this.organizationId;
    const userId = this.userId;
    if (!organizationId || !userId) return;
    await this.publish({ running: true });
    try {
      await this.store.recoverStaleSending(this.now() - SENDING_STALE_MS, this.now());
      await this.drain(userId, organizationId);
      await this.pullAll(organizationId);
      await this.publish({
        online: true,
        lastError: null,
        lastSyncedAt: new Date(this.now()).toISOString(),
        revision: this.revision,
      });
    } catch (error) {
      await this.publish({
        online: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await this.publish({ running: false });
    }
  }

  private async drain(userId: string, organizationId: string): Promise<void> {
    for (let index = 0; index < MAX_COMMANDS_PER_PASS; index += 1) {
      const row = await this.store.nextReady(userId, organizationId, this.now());
      if (!row) return;
      // A row from another account or organization is not this pass's work. It
      // stays bound to its owner and is never rewritten.
      if (row.userId !== userId || row.organizationId !== organizationId || row.id === undefined) {
        return;
      }
      await this.store.markSending(row.id);
      let result: CommandResult;
      try {
        result = await this.transport.push(row.envelope);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.store.markRetry(
          row.id,
          message,
          this.now() + backoffMs(row.attempts, this.random),
        );
        throw error;
      }

      if (isAccepted(result.status)) {
        await this.store.markSent(row.id, result);
        if (typeof result.cursor === "number") {
          // The server's change log may already contain this operation; the
          // pull below is what makes the local replica agree.
          await this.pullAll(organizationId);
        }
        continue;
      }

      if (isRetryable(result.status)) {
        await this.store.markRetry(
          row.id,
          result.message ?? result.code ?? "The server asked the device to retry.",
          this.now() + backoffMs(row.attempts, this.random),
        );
        continue;
      }

      if (isTerminalRefusal(result.status)) {
        const conflict: ConflictRow = {
          id: crypto.randomUUID(),
          organizationId,
          operationId: row.operationId,
          command: row.command,
          entity:
            typeof row.envelope.payload.shiftId === "string" ? row.envelope.payload.shiftId : null,
          code: result.code ?? result.status,
          message: result.message ?? "The server refused this change.",
          classification: conflictClassFor(row.command, result.code),
          localPayload: row.envelope.payload,
          authoritative: result.authoritative ?? null,
          status: "open",
          createdAt: new Date(this.now()).toISOString(),
          resolvedAt: null,
        };
        await this.store.markRefused(row.id, result, conflict);
        this.emit({ type: "conflict", conflict });
        // The authoritative state may already have moved past this command;
        // pulling now is what lets the screen explain both versions.
        await this.pullAll(organizationId);
        continue;
      }

      // An unknown status is not success. Treat it as a retryable fault rather
      // than deleting the volunteer's work.
      await this.store.markRetry(
        row.id,
        `Unrecognised result status: ${String(result.status)}`,
        this.now() + backoffMs(row.attempts, this.random),
      );
    }
  }

  private async pullAll(organizationId: string): Promise<void> {
    for (let batch = 0; batch < MAX_PULL_BATCHES; batch += 1) {
      const cursor = await this.store.readCursor(organizationId);
      const result = await this.transport.pull(organizationId, cursor, 500);
      if (result.status !== "ok") {
        throw new Error("This device no longer has access to that organization.");
      }
      if (result.cursor > cursor) {
        // The cursor moves only if the same transaction wrote the rows. A
        // batch can be empty when every row in it is invisible to this member;
        // the cursor still has to move or the next poll reads it forever.
        await this.store.applyPull(organizationId, result.changes, result.cursor);
        if (result.changes.length > 0) this.emit({ type: "data" });
      }
      this.revision = result.revision;
      await this.store.writeRevision(organizationId, result.revision);
      if (!result.hasMore) return;
    }
  }
}
