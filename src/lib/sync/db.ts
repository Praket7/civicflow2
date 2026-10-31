import Dexie, { type Table } from "dexie";
import type { Change, CommandEnvelope, CommandResult, CommandType } from "./protocol";

/**
 * The volunteer replica.
 *
 * It stores only what the server chose to return for this signed-in volunteer:
 * their own profile, their organization's public shifts, and their own
 * participation. Nothing here is authoritative. The outbox and the cursor are
 * the only records the device owns.
 */

export interface EntityRow {
  organizationId: string;
  entity: string;
  id: string;
  sequence: number;
  deleted: boolean;
  payload: Record<string, unknown>;
}

export type OutboxState = "pending" | "sending" | "conflict" | "failed" | "sent";

export interface OutboxRow {
  id?: number;
  operationId: string;
  organizationId: string;
  /**
   * The account that performed the work. A queued command survives sign-out,
   * so without an owner the next person to sign in could upload it as their
   * own. Empty only on rows written before this field existed; those are never
   * uploaded.
   */
  userId: string;
  command: CommandType;
  envelope: CommandEnvelope;
  createdAt: string;
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number;
  /** When upload started. Crash recovery uses this, never the clock skew of a device. */
  sendingAt: number | null;
  result: CommandResult | null;
}

export type ConflictClass = "field" | "invariant" | "append";

export interface ConflictRow {
  id: string;
  organizationId: string;
  operationId: string;
  command: string;
  entity: string | null;
  code: string;
  message: string;
  classification: ConflictClass;
  localPayload: Record<string, unknown>;
  authoritative: Record<string, unknown> | null;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}

interface MetaRow {
  key: string;
  value: string;
}

export class VolunteerDatabase extends Dexie {
  entities!: Table<EntityRow, [string, string, string]>;
  outbox!: Table<OutboxRow, number>;
  conflicts!: Table<ConflictRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("civicflow-volunteer");
    this.version(1).stores({
      entities: "[organizationId+entity+id], [organizationId+entity], organizationId, sequence",
      outbox: "++id, &operationId, [organizationId+state], state, nextAttemptAt, sendingAt",
      conflicts: "id, organizationId, status, createdAt",
      meta: "key",
    });
    this.version(2)
      .stores({
        entities: "[organizationId+entity+id], [organizationId+entity], organizationId, sequence",
        outbox:
          "++id, &operationId, [organizationId+state], [userId+organizationId+state], state, nextAttemptAt, sendingAt",
        conflicts: "id, organizationId, status, createdAt",
        meta: "key",
      })
      .upgrade(async (transaction) => {
        // A command queued before the outbox recorded its owner cannot be
        // attributed to anybody. Keep the row for inspection, but never upload
        // it under whichever session happens to be open next.
        await transaction
          .table("outbox")
          .toCollection()
          .modify((row: OutboxRow) => {
            if (!row.userId) {
              row.userId = "";
              row.state = "failed";
              row.lastError =
                "This change was queued before the app recorded who made it. Please enter it again.";
            }
          });
      });
  }
}

let database: VolunteerDatabase | null = null;

export function volunteerDb(): VolunteerDatabase {
  database ??= new VolunteerDatabase();
  return database;
}

const REPLICA_KEY = "replicaId";

/** One id per installed copy; commands from a reinstalled app are new work. */
export async function replicaId(): Promise<string> {
  const db = volunteerDb();
  const existing = await db.meta.get(REPLICA_KEY);
  if (existing) return existing.value;
  const created = crypto.randomUUID();
  await db.meta.put({ key: REPLICA_KEY, value: created });
  return created;
}

export async function readCursor(organizationId: string): Promise<number> {
  const row = await volunteerDb().meta.get(`cursor:${organizationId}`);
  return row ? Number(row.value) || 0 : 0;
}

export async function writeWorkspace(organizationId: string): Promise<void> {
  await volunteerDb().meta.put({ key: "workspace", value: organizationId });
}

export async function readWorkspace(): Promise<string | null> {
  const row = await volunteerDb().meta.get("workspace");
  return row?.value ?? null;
}

export async function clearVolunteerCache(): Promise<void> {
  const db = volunteerDb();
  // Signing out removes the volunteer's replica, but keeps an outbox that has
  // not been sent: it is work the volunteer performed, and losing it silently
  // would be worse than showing it after the next sign-in.
  await db.transaction("rw", db.entities, db.meta, db.conflicts, async () => {
    await db.entities.clear();
    await db.conflicts.clear();
    const pending = await db.meta.get("workspace");
    await db.meta.clear();
    if (pending) await db.meta.put(pending);
    const replica = await db.meta.get(REPLICA_KEY);
    if (!replica) await db.meta.put({ key: REPLICA_KEY, value: crypto.randomUUID() });
  });
}

/** Applies one pulled batch and advances the cursor in the same transaction. */
export async function applyChanges(
  organizationId: string,
  changes: Change[],
  cursor: number,
): Promise<void> {
  const db = volunteerDb();
  await db.transaction("rw", db.entities, db.meta, async () => {
    for (const change of changes) {
      if (change.operation === "delete" || !change.payload) {
        await db.entities.delete([organizationId, change.entity, change.id]);
        continue;
      }
      await db.entities.put({
        organizationId,
        entity: change.entity,
        id: change.id,
        sequence: change.sequence,
        deleted: false,
        payload: change.payload,
      });
    }
    await db.meta.put({ key: `cursor:${organizationId}`, value: String(cursor) });
  });
}

export async function entitiesOf(
  organizationId: string,
  entity: string,
): Promise<Record<string, unknown>[]> {
  const rows = await volunteerDb()
    .entities.where("[organizationId+entity]")
    .equals([organizationId, entity])
    .toArray();
  return rows.map((row) => row.payload);
}

export async function entityById(
  organizationId: string,
  entity: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const row = await volunteerDb().entities.get([organizationId, entity, id]);
  return row?.payload ?? null;
}
