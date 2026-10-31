import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  applySharedRosterPlan,
  checkInShared,
  createSharedOpportunity,
  createSharedSeries,
  listSharedConflicts,
  resolveSharedConflict,
  reviewSharedHours,
  updateSharedShift,
} from "./writes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./desktop", () => ({
  desktopSyncSnapshot: () => ({
    organizationId: "11111111-1111-4111-8111-111111111111",
    revision: 7,
  }),
  startDesktopSync: vi.fn(async () => ({})),
  syncDesktopNow: vi.fn(async () => ({})),
}));

const mock = vi.mocked(invoke);
const SHIFT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const VOLUNTEER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue(1);
});

describe("shared coordinator writes", () => {
  it("publishes a weekly repeat as one atomic command with absolute occurrences", async () => {
    const id = await createSharedSeries({
      opportunityId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      startsOn: "2026-11-01",
      startsTime: "09:00",
      durationMinutes: 120,
      capacity: 6,
      roles: [{ name: "Greeter", required: 2 }],
      occurrenceCount: 3,
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mock).toHaveBeenCalledWith(
      "sync_enqueue_command",
      expect.objectContaining({
        command: "CREATE_SHIFT_SERIES",
        payload: expect.objectContaining({
          id,
          opportunityId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
          capacity: 6,
          recurrence: expect.objectContaining({
            kind: "weekly",
            intervalWeeks: 1,
            startsLocalTime: "09:00",
            occurrenceCount: 3,
          }),
          occurrences: expect.arrayContaining([
            expect.objectContaining({ date: "2026-11-01" }),
            expect.objectContaining({ date: "2026-11-15" }),
          ]),
        }),
      }),
    );
    const payload = mock.mock.calls.at(-1)?.[1] as { payload: { occurrences: unknown[] } };
    expect(payload.payload.occurrences).toHaveLength(3);
  });

  it("keeps a weekly series at the same local clock time across a DST change", async () => {
    const { seriesOccurrences } = await import("./writes");
    const occurrences = seriesOccurrences({
      opportunityId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      startsOn: "2026-03-01",
      startsTime: "09:00",
      durationMinutes: 60,
      capacity: 4,
      roles: [],
      occurrenceCount: 3,
    });

    const hours = occurrences.map((occurrence) => new Date(occurrence.startsAt).getHours());
    expect(hours).toEqual([9, 9, 9]);
  });

  it("lets Rust bind a new opportunity to the signed-in workspace", async () => {
    const id = await createSharedOpportunity({ title: "Saturday pantry", capacity: 12 });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mock).toHaveBeenCalledWith(
      "sync_enqueue_command",
      expect.objectContaining({
        organizationId: "11111111-1111-4111-8111-111111111111",
        command: "CREATE_OPPORTUNITY",
        payload: expect.objectContaining({
          id,
          title: "Saturday pantry",
          capacity: 12,
        }),
        entityVersions: {},
        baseRevision: undefined,
      }),
    );
  });

  it("sends the row version the edit was built against", async () => {
    await updateSharedShift(
      { id: SHIFT, row_version: 4, capacity: 6 },
      { capacity: 5, status: "scheduled" },
    );

    expect(mock).toHaveBeenCalledWith(
      "sync_enqueue_command",
      expect.objectContaining({
        command: "UPDATE_SHIFT",
        payload: { id: SHIFT, capacity: 5, status: "scheduled" },
        entityVersions: { [`shift:${SHIFT}`]: 4 },
      }),
    );
  });

  it("guards a roster plan with the revision it was generated at", async () => {
    await applySharedRosterPlan([{ shiftId: SHIFT, volunteerId: VOLUNTEER, role: "Greeter" }]);

    expect(mock).toHaveBeenCalledWith(
      "sync_enqueue_command",
      expect.objectContaining({
        command: "APPLY_ROSTER_PLAN",
        payload: {
          assignments: [{ shiftId: SHIFT, volunteerId: VOLUNTEER, role: "Greeter" }],
        },
        baseRevision: 7,
      }),
    );
  });

  it("records attendance and hours as commands, not local table writes", async () => {
    await checkInShared(SHIFT, VOLUNTEER);
    expect(mock).toHaveBeenCalledWith(
      "sync_enqueue_command",
      expect.objectContaining({
        command: "CHECK_IN",
        payload: expect.objectContaining({ shiftId: SHIFT, volunteerId: VOLUNTEER }),
      }),
    );

    await reviewSharedHours(
      { id: "99999999-9999-4999-8999-999999999999", row_version: 2, minutes: 90 },
      "verified",
      90,
    );
    expect(mock).toHaveBeenCalledWith(
      "sync_enqueue_command",
      expect.objectContaining({
        command: "REVIEW_HOURS",
        payload: expect.objectContaining({ status: "verified", approvedMinutes: 90 }),
        entityVersions: { "hour_entry:99999999-9999-4999-8999-999999999999": 2 },
      }),
    );
  });

  it("reads and closes conflict records through Rust", async () => {
    mock.mockResolvedValueOnce([]);
    await expect(listSharedConflicts()).resolves.toEqual([]);
    expect(mock).toHaveBeenCalledWith("sync_list_conflicts", {
      organizationId: "11111111-1111-4111-8111-111111111111",
    });

    mock.mockResolvedValueOnce(undefined);
    await resolveSharedConflict("conflict-1", "resolved");
    expect(mock).toHaveBeenCalledWith("sync_resolve_conflict", {
      organizationId: "11111111-1111-4111-8111-111111111111",
      conflictId: "conflict-1",
      resolution: "resolved",
    });
  });
});
