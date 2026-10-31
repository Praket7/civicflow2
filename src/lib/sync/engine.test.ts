import { SyncEngine, type SyncStore, type SyncTransport } from "./engine";
import type { ConflictRow, OutboxRow } from "./db";
import type { Change, CommandEnvelope, CommandResult, PullResult } from "./protocol";

class MemoryStore implements SyncStore {
  rows: OutboxRow[] = [];
  conflicts: ConflictRow[] = [];
  cursors = new Map<string, number>();
  revisions = new Map<string, number>();
  applied: Change[] = [];
  private nextId = 1;

  enqueue(
    organizationId: string,
    command: OutboxRow["command"],
    payload: Record<string, unknown>,
    userId = USER,
  ): OutboxRow {
    const envelope: CommandEnvelope = {
      operationId: crypto.randomUUID(),
      replicaId: "replica-test",
      userId,
      organizationId,
      command,
      membershipEpoch: 1,
      baseWorkspaceRevision: 0,
      entityVersions: {},
      payload,
      clientCreatedAt: new Date(0).toISOString(),
    };
    const row: OutboxRow = {
      id: this.nextId++,
      operationId: envelope.operationId,
      organizationId,
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

  async recoverStaleSending(cutoff: number): Promise<number> {
    let recovered = 0;
    for (const row of this.rows) {
      if (row.state === "sending" && (row.sendingAt ?? 0) < cutoff) {
        row.state = "pending";
        recovered += 1;
      }
    }
    return recovered;
  }

  async nextReady(userId: string, organizationId: string, now: number): Promise<OutboxRow | null> {
    return (
      this.rows
        .filter(
          (row) =>
            row.userId === userId &&
            row.organizationId === organizationId &&
            row.state === "pending" &&
            row.nextAttemptAt <= now,
        )
        .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))[0] ?? null
    );
  }

  async markSending(id: number): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) {
      row.state = "sending";
      row.sendingAt = Date.now();
    }
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
    if (row) row.state = "conflict";
    if (row) row.result = result;
    this.conflicts.push(conflict);
  }

  async pendingCount(userId: string, organizationId: string): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.userId === userId && row.organizationId === organizationId && row.state === "pending",
    ).length;
  }

  async openConflictCount(organizationId: string): Promise<number> {
    return this.conflicts.filter(
      (row) => row.organizationId === organizationId && row.status === "open",
    ).length;
  }

  async readCursor(organizationId: string): Promise<number> {
    return this.cursors.get(organizationId) ?? 0;
  }

  async applyPull(organizationId: string, changes: Change[], cursor: number): Promise<void> {
    this.applied.push(...changes);
    this.cursors.set(organizationId, cursor);
  }

  async readRevision(organizationId: string): Promise<number> {
    return this.revisions.get(organizationId) ?? 0;
  }

  async writeRevision(organizationId: string, revision: number): Promise<void> {
    this.revisions.set(organizationId, revision);
  }
}

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "user-alice";

function transport(
  push: (envelope: CommandEnvelope) => Promise<CommandResult>,
  changes: Change[] = [],
): SyncTransport {
  return {
    push,
    async pull(): Promise<PullResult> {
      return {
        status: "ok",
        cursor: changes.at(-1)?.sequence ?? 0,
        hasMore: false,
        revision: 1,
        changes,
      };
    },
  };
}

function engineFor(store: MemoryStore, sync: SyncTransport, now: () => number): SyncEngine {
  return new SyncEngine({ store, transport: sync, now, random: () => 0 });
}

describe("sync engine", () => {
  it("uploads a queued command once, including after a restart", async () => {
    const store = new MemoryStore();
    store.enqueue(ORG, "REGISTER_FOR_SHIFT", { shiftId: "shift-1" });
    let calls = 0;
    const sync = transport(async () => {
      calls += 1;
      return { status: "applied", cursor: 4 };
    });

    const first = engineFor(store, sync, () => 0);
    await first.start(USER, ORG);
    first.stop();
    expect(calls).toBe(1);
    expect(store.rows[0]?.state).toBe("sent");

    const second = engineFor(store, sync, () => 0);
    await second.start(USER, ORG);
    second.stop();
    expect(calls).toBe(1);
  });

  it("treats already_applied as success, not as new work", async () => {
    const store = new MemoryStore();
    store.enqueue(ORG, "REGISTER_FOR_SHIFT", { shiftId: "shift-1" });
    const sync = transport(async () => ({ status: "already_applied", cursor: 9 }));
    const engine = engineFor(store, sync, () => 0);
    await engine.start(USER, ORG);
    engine.stop();
    expect(store.rows[0]?.state).toBe("sent");
    expect(store.conflicts).toHaveLength(0);
  });

  it("never confirms two volunteers for one remaining seat", async () => {
    const server = {
      registrations: [] as string[],
      async push(envelope: CommandEnvelope): Promise<CommandResult> {
        const volunteer = String(envelope.payload.volunteerId);
        if (server.registrations.length >= 1) {
          return {
            status: "conflict",
            code: "capacity_full",
            message: "Every seat on this shift is taken.",
            authoritative: { capacity: 1, confirmed: 1 },
          };
        }
        server.registrations.push(volunteer);
        return { status: "applied", cursor: 1 };
      },
    };

    const alice = new MemoryStore();
    const bob = new MemoryStore();
    alice.enqueue(ORG, "REGISTER_FOR_SHIFT", { shiftId: "shift-1", volunteerId: "alice" });
    bob.enqueue(ORG, "REGISTER_FOR_SHIFT", { shiftId: "shift-1", volunteerId: "bob" });
    const sync = transport((envelope) => server.push(envelope));

    const engineA = engineFor(alice, sync, () => 0);
    const engineB = engineFor(bob, sync, () => 0);
    await Promise.all([engineA.start(USER, ORG), engineB.start(USER, ORG)]);
    engineA.stop();
    engineB.stop();

    expect(server.registrations).toEqual(["alice"]);
    expect(alice.rows[0]?.state).toBe("sent");
    expect(bob.rows[0]?.state).toBe("conflict");
    expect(bob.conflicts[0]?.code).toBe("capacity_full");
    expect(bob.conflicts[0]?.classification).toBe("invariant");
  });

  it("retries the same operation after a lost response without duplicating the write", async () => {
    const store = new MemoryStore();
    store.enqueue(ORG, "CHECK_IN", { shiftId: "shift-1", volunteerId: "alice" });
    const operations = new Map<string, number>();
    let commit = 0;
    let drop = true;
    let clock = 0;
    const sync = transport(async (envelope) => {
      const seen = (operations.get(envelope.operationId) ?? 0) + 1;
      operations.set(envelope.operationId, seen);
      if (seen === 1) {
        commit += 1;
        if (drop) {
          drop = false;
          throw new Error("Network closed after the server committed.");
        }
      }
      return { status: seen === 1 ? "applied" : "already_applied", cursor: 1 };
    });

    const engine = engineFor(store, sync, () => clock);
    await engine.start(USER, ORG);
    expect(commit).toBe(1);
    expect(store.rows[0]?.state).toBe("pending");
    expect(store.rows[0]?.attempts).toBe(1);

    clock = 10 * 60_000;
    await engine.syncNow();
    engine.stop();
    expect(commit).toBe(1);
    expect(store.rows[0]?.state).toBe("sent");
    expect(store.rows[0]?.result?.status).toBe("already_applied");
  });

  it("refuses a second device's roster plan after the revision moved", async () => {
    let revision = 0;
    const sync = transport(async (envelope) => {
      if (envelope.baseWorkspaceRevision < revision) {
        return {
          status: "stale_plan",
          code: "stale_plan",
          message: "The organization changed after this plan was built.",
          authoritative: { revision },
        };
      }
      revision += 1;
      return { status: "applied", cursor: revision, serverRevision: revision };
    });

    const first = new MemoryStore();
    first.enqueue(ORG, "APPLY_ROSTER_PLAN", { assignments: [{ volunteerId: "alice" }] });
    const firstEngine = engineFor(first, sync, () => 0);
    await firstEngine.start(USER, ORG);
    firstEngine.stop();
    expect(first.rows[0]?.state).toBe("sent");

    const second = new MemoryStore();
    second.enqueue(ORG, "APPLY_ROSTER_PLAN", { assignments: [{ volunteerId: "bob" }] });
    const secondEngine = engineFor(second, sync, () => 0);
    await secondEngine.start(USER, ORG);
    secondEngine.stop();

    expect(second.rows[0]?.state).toBe("conflict");
    expect(second.conflicts[0]?.code).toBe("stale_plan");
    expect(second.conflicts[0]?.classification).toBe("invariant");
    expect(second.conflicts[0]?.authoritative).toEqual({ revision: 1 });
  });

  it("records stale authority as an invariant conflict", async () => {
    const store = new MemoryStore();
    store.enqueue(ORG, "CREATE_OPPORTUNITY", { title: "Pantry" });
    const sync = transport(async () => ({
      status: "stale_authority",
      code: "stale_authority",
      message: "Your access changed while this device was offline.",
      membershipEpoch: 4,
    }));
    const engine = engineFor(store, sync, () => 0);
    await engine.start(USER, ORG);
    engine.stop();
    expect(store.conflicts[0]?.classification).toBe("invariant");
    expect(store.conflicts[0]?.code).toBe("stale_authority");
    expect(store.rows[0]?.state).toBe("conflict");
  });

  it("does not upload another organization's queued work", async () => {
    const store = new MemoryStore();
    store.enqueue("22222222-2222-4222-8222-222222222222", "REGISTER_FOR_SHIFT", {
      shiftId: "shift-9",
    });
    let calls = 0;
    const sync = transport(async () => {
      calls += 1;
      return { status: "applied" };
    });
    const engine = engineFor(store, sync, () => 0);
    await engine.start(USER, ORG);
    engine.stop();
    expect(calls).toBe(0);
    expect(store.rows[0]?.state).toBe("pending");
  });

  it("does not upload work queued by the previous account on this device", async () => {
    const store = new MemoryStore();
    // Alice went offline, queued a registration, then signed out before it sent.
    store.enqueue(ORG, "REGISTER_FOR_SHIFT", { shiftId: "shift-1" }, "user-alice");
    let calls = 0;
    const sync = transport(async () => {
      calls += 1;
      return { status: "applied" };
    });

    const bob = engineFor(store, sync, () => 0);
    await bob.start("user-bob", ORG);
    bob.stop();
    expect(calls).toBe(0);
    expect(store.rows[0]?.state).toBe("pending");
    expect(store.rows[0]?.userId).toBe("user-alice");

    // Alice signing back in finishes her own work.
    const alice = engineFor(store, sync, () => 0);
    await alice.start("user-alice", ORG);
    alice.stop();
    expect(calls).toBe(1);
    expect(store.rows[0]?.state).toBe("sent");
  });

  it("moves the cursor past a batch with no rows this member can see", async () => {
    const store = new MemoryStore();
    const sync: SyncTransport = {
      async push() {
        return { status: "applied" };
      },
      async pull() {
        return { status: "ok", cursor: 7, hasMore: false, revision: 2, changes: [] };
      },
    };
    const engine = engineFor(store, sync, () => 0);
    await engine.start(USER, ORG);
    engine.stop();

    // Without this the next poll re-reads the same invisible changes forever.
    expect(await store.readCursor(ORG)).toBe(7);
    expect(await store.readRevision(ORG)).toBe(2);
  });

  it("recovers a sending row left behind by a crash", async () => {
    const store = new MemoryStore();
    const row = store.enqueue(ORG, "CHECK_OUT", { shiftId: "shift-1" });
    row.state = "sending";
    row.sendingAt = 0;
    let calls = 0;
    const sync = transport(async () => {
      calls += 1;
      return { status: "applied" };
    });
    const engine = engineFor(store, sync, () => 5 * 60_000);
    await engine.start(USER, ORG);
    engine.stop();
    expect(calls).toBe(1);
    expect(store.rows[0]?.state).toBe("sent");
  });
});
