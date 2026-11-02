import { describe, expect, it } from "vitest";
import type { ConflictRow, OutboxRow } from "./db";
import { SyncEngine, type SyncStore, type SyncTransport } from "./engine";
import type { Change, CommandEnvelope, CommandResult, CommandType, PullResult } from "./protocol";

const ORG = "11111111-1111-4111-8111-111111111111";
const SHIFT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const OPPORTUNITY = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const BOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const VOLUNTEER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

type Row = Record<string, unknown>;

/** A durable replica and outbox, with the same ordering rule the real stores use. */
class DeviceStore implements SyncStore {
  rows: OutboxRow[] = [];
  conflicts: ConflictRow[] = [];
  entities = new Map<string, Row>();
  cursor = 0;
  revision = 0;
  private nextId = 1;

  enqueue(
    command: CommandType,
    payload: Record<string, unknown>,
    userId: string,
    entityVersions: Record<string, number> = {},
  ): OutboxRow {
    const envelope: CommandEnvelope = {
      operationId: crypto.randomUUID(),
      replicaId: `replica-${userId}`,
      userId,
      organizationId: ORG,
      command,
      membershipEpoch: 1,
      baseWorkspaceRevision: this.revision,
      entityVersions,
      payload,
      clientCreatedAt: new Date(0).toISOString(),
    };
    const row: OutboxRow = {
      id: this.nextId++,
      operationId: envelope.operationId,
      organizationId: ORG,
      userId,
      command,
      envelope,
      createdAt: envelope.clientCreatedAt,
      state: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: 0,
      sendingAt: null,
      result: null,
    };
    this.rows.push(row);
    return row;
  }

  entity(entity: string, id: string): Row | undefined {
    return this.entities.get(`${entity}:${id}`);
  }

  async recoverStaleSending(): Promise<number> {
    return 0;
  }

  async nextReady(userId: string, organizationId: string, now: number) {
    const earliest =
      this.rows
        .filter(
          (row) =>
            row.userId === userId &&
            row.organizationId === organizationId &&
            row.state === "pending",
        )
        .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))[0] ?? null;
    if (!earliest || earliest.nextAttemptAt > now) return null;
    return earliest;
  }

  async markSending(id: number): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) row.state = "sending";
  }

  async markSent(id: number, result: CommandResult): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) {
      row.state = "sent";
      row.result = result;
    }
  }

  async markRetry(id: number, error: string, nextAttemptAt: number): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) {
      row.state = "pending";
      row.attempts += 1;
      row.lastError = error;
      row.nextAttemptAt = nextAttemptAt;
    }
  }

  async markRefused(id: number, result: CommandResult, conflict: ConflictRow): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) {
      row.state = "conflict";
      row.result = result;
    }
    this.conflicts.push(conflict);
  }

  async pendingCount(userId: string, organizationId: string): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.userId === userId && row.organizationId === organizationId && row.state === "pending",
    ).length;
  }

  async openConflictCount(): Promise<number> {
    return this.conflicts.filter((row) => row.status === "open").length;
  }

  async readCursor(): Promise<number> {
    return this.cursor;
  }

  async applyPull(_organizationId: string, changes: Change[], cursor: number): Promise<void> {
    for (const change of changes) {
      const key = `${change.entity}:${change.id}`;
      if (change.operation === "delete" || !change.payload) this.entities.delete(key);
      else this.entities.set(key, change.payload);
    }
    this.cursor = cursor;
  }

  async readRevision(): Promise<number> {
    return this.revision;
  }

  async writeRevision(_organizationId: string, revision: number): Promise<void> {
    this.revision = revision;
  }
}

/** One authoritative server with an idempotent command log and one change stream. */
class Authority implements SyncTransport {
  online = true;
  revision = 0;
  sequence = 0;
  changes: Change[] = [];
  rows = new Map<string, Row>();
  private operations = new Map<string, CommandResult>();

  row(entity: string, id: string): Row | undefined {
    return this.rows.get(`${entity}:${id}`);
  }

  private change(entity: string, id: string, payload: Row): Change {
    this.sequence += 1;
    this.revision += 1;
    const change: Change = {
      sequence: this.sequence,
      entity,
      id,
      operation: "update",
      rowVersion: Number(payload.row_version ?? 1),
      payload: structuredClone(payload),
    };
    this.changes.push(change);
    this.rows.set(`${entity}:${id}`, structuredClone(payload));
    return change;
  }

  private applied(): CommandResult {
    return { status: "applied", cursor: this.sequence, serverRevision: this.revision };
  }

  private versionOf(entity: string, id: string): number {
    return Number(this.row(entity, id)?.row_version ?? 1);
  }

  async push(envelope: CommandEnvelope): Promise<CommandResult> {
    if (!this.online) throw new Error("The organization is unreachable.");
    const prior = this.operations.get(envelope.operationId);
    if (prior) return { ...prior, status: "already_applied" };
    const result = this.apply(envelope);
    this.operations.set(envelope.operationId, result);
    return result;
  }

  private apply(envelope: CommandEnvelope): CommandResult {
    const payload = envelope.payload;
    const id = String(payload.id ?? payload.shiftId ?? "");
    switch (envelope.command) {
      case "CREATE_OPPORTUNITY":
        this.change("opportunity", id, { ...payload, id, row_version: 1 });
        return this.applied();
      case "CREATE_SHIFT":
        this.change("shift", id, {
          ...payload,
          id,
          confirmed: 0,
          row_version: 1,
        });
        return this.applied();
      case "UPDATE_SHIFT": {
        const current = this.row("shift", id);
        const expected = envelope.entityVersions[`shift:${id}`];
        if (!current) return { status: "conflict", code: "not_found", message: "Missing shift." };
        if (expected !== undefined && expected !== this.versionOf("shift", id)) {
          return {
            status: "conflict",
            code: "version_conflict",
            message: "This record changed elsewhere.",
            authoritative: current,
          };
        }
        this.change("shift", id, {
          ...current,
          ...payload,
          row_version: this.versionOf("shift", id) + 1,
        });
        return this.applied();
      }
      case "REGISTER_FOR_SHIFT": {
        const shiftId = String(payload.shiftId);
        const shift = this.row("shift", shiftId);
        if (!shift) return { status: "conflict", code: "not_found", message: "Missing shift." };
        if (Number(shift.confirmed) >= Number(shift.capacity)) {
          return {
            status: "conflict",
            code: "capacity_full",
            message: "Every seat on this shift is taken.",
            authoritative: shift,
          };
        }
        const volunteerId = String(payload.volunteerId);
        const registration = {
          id: `reg-${volunteerId}`,
          shift_id: shiftId,
          volunteer_id: volunteerId,
          status: "registered",
          row_version: 1,
        };
        this.change("registration", registration.id, registration);
        this.change("shift", shiftId, {
          ...shift,
          confirmed: Number(shift.confirmed) + 1,
          row_version: Number(shift.row_version) + 1,
        });
        return this.applied();
      }
      default:
        return { status: "validation_error", message: "This harness does not model that command." };
    }
  }

  async pull(_organizationId: string, cursor: number): Promise<PullResult> {
    if (!this.online) throw new Error("The organization is unreachable.");
    return {
      status: "ok",
      cursor: this.sequence,
      hasMore: false,
      revision: this.revision,
      changes: this.changes.filter((change) => change.sequence > cursor),
    };
  }
}

function engine(store: DeviceStore, authority: Authority, now: () => number): SyncEngine {
  return new SyncEngine({ store, transport: authority, now, random: () => 0, pollMs: 60_000 });
}

describe("three replicas converge", () => {
  it("shares coordinator edits, refuses a stale edit, fills the last seat, and recovers an offline queue", async () => {
    let clock = 1_000;
    const alice = new DeviceStore();
    const bob = new DeviceStore();
    const phone = new DeviceStore();
    const authority = new Authority();
    const aliceEngine = engine(alice, authority, () => clock);
    const bobEngine = engine(bob, authority, () => clock);
    const phoneEngine = engine(phone, authority, () => clock);
    await Promise.all([
      aliceEngine.start(ALICE, ORG),
      bobEngine.start(BOB, ORG),
      phoneEngine.start(VOLUNTEER, ORG),
    ]);

    alice.enqueue("CREATE_OPPORTUNITY", { id: OPPORTUNITY, title: "Pantry" }, ALICE);
    alice.enqueue(
      "CREATE_SHIFT",
      {
        id: SHIFT,
        opportunityId: OPPORTUNITY,
        startsAt: "2030-06-01T09:00:00.000Z",
        endsAt: "2030-06-01T12:00:00.000Z",
        capacity: 2,
      },
      ALICE,
    );
    await aliceEngine.syncNow();
    await Promise.all([bobEngine.syncNow(), phoneEngine.syncNow()]);
    expect(bob.entity("shift", SHIFT)?.capacity).toBe(2);
    expect(phone.entity("shift", SHIFT)?.capacity).toBe(2);

    bob.enqueue("UPDATE_SHIFT", { id: SHIFT, capacity: 1 }, BOB, { [`shift:${SHIFT}`]: 1 });
    await bobEngine.syncNow();
    await Promise.all([aliceEngine.syncNow(), phoneEngine.syncNow()]);
    expect(alice.entity("shift", SHIFT)?.capacity).toBe(1);

    const stale = alice.enqueue("UPDATE_SHIFT", { id: SHIFT, capacity: 5 }, ALICE, {
      [`shift:${SHIFT}`]: 1,
    });
    await aliceEngine.syncNow();
    expect(stale.state).toBe("conflict");
    expect(alice.conflicts[0]?.code).toBe("version_conflict");

    phone.enqueue("REGISTER_FOR_SHIFT", { shiftId: SHIFT, volunteerId: "vol-1" }, VOLUNTEER);
    await phoneEngine.syncNow();
    await Promise.all([aliceEngine.syncNow(), bobEngine.syncNow()]);
    expect(alice.entity("registration", "reg-vol-1")?.status).toBe("registered");
    expect(authority.row("shift", SHIFT)?.confirmed).toBe(1);

    authority.online = false;
    const version = Number(alice.entity("shift", SHIFT)?.row_version);
    const queued = alice.enqueue("UPDATE_SHIFT", { id: SHIFT, capacity: 2 }, ALICE, {
      [`shift:${SHIFT}`]: version,
    });
    await aliceEngine.syncNow();
    expect(queued.state).toBe("pending");

    clock += 10_000;
    authority.online = true;
    await aliceEngine.syncNow();
    await Promise.all([bobEngine.syncNow(), phoneEngine.syncNow()]);
    expect(queued.state).toBe("sent");
    expect(bob.entity("shift", SHIFT)?.capacity).toBe(2);
    expect(phone.entity("shift", SHIFT)?.capacity).toBe(2);

    aliceEngine.stop();
    bobEngine.stop();
    phoneEngine.stop();
  });
});
