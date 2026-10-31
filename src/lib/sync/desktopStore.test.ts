import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ConflictRow, OutboxRow } from "./db";
import {
  applyBootstrap,
  configureReplica,
  listReplicaWorkspaces,
  readReplicaEntities,
  replicaStatus,
  TauriSyncStore,
} from "./desktopStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mock = vi.mocked(invoke);
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

function outbox(): OutboxRow {
  return {
    id: 4,
    operationId: "10000000-0000-4000-8000-000000000001",
    organizationId: ORG,
    userId: USER,
    command: "UPDATE_SHIFT",
    envelope: {
      operationId: "10000000-0000-4000-8000-000000000001",
      replicaId: "00000000-0000-4000-8000-0000000000a1",
      userId: USER,
      organizationId: ORG,
      command: "UPDATE_SHIFT",
      membershipEpoch: 2,
      baseWorkspaceRevision: 4,
      entityVersions: {},
      payload: { shiftId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2" },
      clientCreatedAt: "2026-11-01T09:00:00.000Z",
    },
    createdAt: "2026-11-01T09:00:00.000Z",
    state: "pending",
    attempts: 0,
    lastError: null,
    nextAttemptAt: 0,
    sendingAt: null,
    result: null,
  };
}

beforeEach(() => {
  mock.mockReset();
});

describe("TauriSyncStore", () => {
  it("reads and applies the cursor through SQLite", async () => {
    const store = new TauriSyncStore();
    mock.mockResolvedValueOnce(7);
    await expect(store.readCursor(ORG)).resolves.toBe(7);
    expect(mock).toHaveBeenCalledWith("sync_read_cursor", { organizationId: ORG });

    mock.mockResolvedValueOnce(undefined);
    const changes = [
      {
        sequence: 8,
        entity: "shift",
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
        operation: "update" as const,
        rowVersion: 2,
        payload: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2", capacity: 5 },
      },
    ];
    await store.applyPull(ORG, changes, 8);
    expect(mock).toHaveBeenCalledWith("sync_apply_changes", {
      organizationId: ORG,
      changes,
      cursor: 8,
    });
  });

  it("keeps the outbox bound to its account and organization", async () => {
    const store = new TauriSyncStore();
    const row = outbox();
    mock.mockResolvedValueOnce(row);
    await expect(store.nextReady(USER, ORG, 1_000)).resolves.toBe(row);
    expect(mock).toHaveBeenCalledWith("sync_next_ready", {
      userId: USER,
      organizationId: ORG,
      now: 1_000,
    });

    await store.markRetry(4, "offline", 2_000);
    expect(mock).toHaveBeenCalledWith("sync_mark_retry", {
      id: 4,
      error: "offline",
      nextAttemptAt: 2_000,
    });

    mock.mockResolvedValueOnce(1);
    await expect(store.pendingCount(USER, ORG)).resolves.toBe(1);
    expect(mock).toHaveBeenCalledWith("sync_pending_count", {
      userId: USER,
      organizationId: ORG,
    });
  });

  it("stores a terminal refusal and its conflict together", async () => {
    const store = new TauriSyncStore();
    const conflict: ConflictRow = {
      id: "30000000-0000-4000-8000-000000000001",
      organizationId: ORG,
      operationId: "10000000-0000-4000-8000-000000000001",
      command: "UPDATE_SHIFT",
      entity: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
      code: "version_conflict",
      message: "Someone changed this shift after your copy was loaded.",
      classification: "field",
      localPayload: { capacity: 6 },
      authoritative: { capacity: 5 },
      status: "open",
      createdAt: "2026-11-01T09:05:00.000Z",
      resolvedAt: null,
    };
    await store.markRefused(4, { status: "conflict" }, conflict);
    expect(mock).toHaveBeenCalledWith("sync_mark_refused", {
      id: 4,
      result: { status: "conflict" },
      conflict,
    });
  });

  it("exposes status and bootstrap without reaching into SQLite from the page", async () => {
    mock.mockResolvedValueOnce({ configured: true, cursor: 9 });
    await configureReplica({ organizationId: ORG, userId: USER, membershipEpoch: 2 });
    expect(mock).toHaveBeenCalledWith("sync_configure", {
      organizationId: ORG,
      userId: USER,
      membershipEpoch: 2,
    });

    const payload = { status: "ok", cursor: 9, revision: 3, entities: {} };
    mock.mockResolvedValueOnce({ configured: true });
    await applyBootstrap({ organizationId: ORG, userId: USER, membershipEpoch: 2, payload });
    expect(mock).toHaveBeenCalledWith("sync_apply_bootstrap", {
      organizationId: ORG,
      userId: USER,
      membershipEpoch: 2,
      payload,
    });

    mock.mockResolvedValueOnce([ORG]);
    await expect(listReplicaWorkspaces()).resolves.toEqual([ORG]);
    mock.mockResolvedValueOnce([]);
    await expect(readReplicaEntities(ORG, "shift")).resolves.toEqual([]);
    expect(mock).toHaveBeenCalledWith("sync_entities", {
      organizationId: ORG,
      entity: "shift",
      limit: 500,
    });
    mock.mockResolvedValueOnce({ configured: false });
    await replicaStatus(ORG);
    expect(mock).toHaveBeenCalledWith("sync_status", { organizationId: ORG });
  });
});
