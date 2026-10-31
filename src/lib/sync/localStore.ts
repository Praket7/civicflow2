import type { Table } from "dexie";
import {
  applyChanges,
  replicaId,
  volunteerDb,
  type ConflictRow,
  type OutboxRow,
  type VolunteerDatabase,
} from "./db";
import type { SyncStore } from "./engine";
import type { Change, CommandResult, CommandType } from "./protocol";
import { withMembershipEpoch } from "./protocol";

export class DexieSyncStore implements SyncStore {
  constructor(private readonly db: VolunteerDatabase = volunteerDb()) {}

  private get outbox(): Table<OutboxRow, number> {
    return this.db.outbox;
  }

  async recoverStaleSending(cutoff: number, now: number): Promise<number> {
    const stale = await this.outbox
      .where("sendingAt")
      .below(cutoff)
      .filter((row) => row.state === "sending")
      .toArray();
    for (const row of stale) {
      if (row.id === undefined) continue;
      await this.outbox.update(row.id, {
        state: "pending",
        sendingAt: null,
        nextAttemptAt: now,
        lastError: "Recovered an interrupted upload. It will be retried.",
      });
    }
    return stale.length;
  }

  async nextReady(userId: string, organizationId: string, now: number): Promise<OutboxRow | null> {
    // Scoped by account as well as organization: work queued by one person is
    // never uploaded by whoever signs in next, even in the same organization.
    const rows = await this.outbox
      .where("[userId+organizationId+state]")
      .equals([userId, organizationId, "pending"])
      .filter((row) => row.nextAttemptAt <= now)
      .sortBy("id");
    return rows[0] ?? null;
  }

  async markSending(id: number): Promise<void> {
    await this.outbox.update(id, { state: "sending", sendingAt: Date.now() });
  }

  async markSent(id: number, result: CommandResult): Promise<void> {
    await this.outbox.update(id, { state: "sent", result, lastError: null, sendingAt: null });
  }

  async markRetry(id: number, error: string, nextAttemptAt: number): Promise<void> {
    const row = await this.outbox.get(id);
    if (!row) return;
    await this.outbox.update(id, {
      state: "pending",
      attempts: row.attempts + 1,
      lastError: error,
      nextAttemptAt,
      sendingAt: null,
    });
  }

  async markRefused(id: number, result: CommandResult, conflict: ConflictRow): Promise<void> {
    await this.db.transaction("rw", this.outbox, this.db.conflicts, async () => {
      await this.outbox.update(id, {
        state: "conflict",
        result,
        lastError: conflict.message,
        sendingAt: null,
      });
      await this.db.conflicts.put(conflict);
    });
  }

  async pendingCount(userId: string, organizationId: string): Promise<number> {
    return this.outbox
      .where("[userId+organizationId+state]")
      .equals([userId, organizationId, "pending"])
      .count();
  }

  async openConflictCount(organizationId: string): Promise<number> {
    return this.db.conflicts
      .where("organizationId")
      .equals(organizationId)
      .filter((row) => row.status === "open")
      .count();
  }

  async readCursor(organizationId: string): Promise<number> {
    const row = await this.db.meta.get(`cursor:${organizationId}`);
    return row ? Number(row.value) || 0 : 0;
  }

  async applyPull(organizationId: string, changes: Change[], cursor: number): Promise<void> {
    await applyChanges(organizationId, changes, cursor);
  }

  async readRevision(organizationId: string): Promise<number> {
    const row = await this.db.meta.get(`revision:${organizationId}`);
    return row ? Number(row.value) || 0 : 0;
  }

  async writeRevision(organizationId: string, revision: number): Promise<void> {
    await this.db.meta.put({ key: `revision:${organizationId}`, value: String(revision) });
  }
}

export interface QueueInput {
  /** The account doing the work; the row is only ever drained for this user. */
  userId: string;
  organizationId: string;
  membershipEpoch: number;
  command: CommandType;
  payload: Record<string, unknown>;
  entityVersions?: Record<string, number>;
  baseRevision?: number;
}

/**
 * Writes the intent before anything else happens. If the browser dies between
 * this call and the upload, the intent is still here on the next launch.
 */
export async function queueCommand(input: QueueInput): Promise<OutboxRow> {
  const db = volunteerDb();
  const envelope = withMembershipEpoch(
    {
      operationId: crypto.randomUUID(),
      replicaId: await replicaId(),
      organizationId: input.organizationId,
      command: input.command,
      baseWorkspaceRevision: input.baseRevision ?? 0,
      entityVersions: input.entityVersions ?? {},
      payload: input.payload,
      clientCreatedAt: new Date().toISOString(),
    },
    input.membershipEpoch,
  );
  const row: OutboxRow = {
    operationId: envelope.operationId,
    organizationId: input.organizationId,
    userId: input.userId,
    command: input.command,
    envelope,
    createdAt: envelope.clientCreatedAt,
    state: "pending",
    attempts: 0,
    lastError: null,
    nextAttemptAt: 0,
    sendingAt: null,
    result: null,
  };
  const id = await db.outbox.add(row);
  return { ...row, id };
}
