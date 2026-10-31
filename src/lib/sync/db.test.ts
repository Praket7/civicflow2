import "fake-indexeddb/auto";
import {
  applyChanges,
  entityById,
  entitiesOf,
  readCursor,
  VolunteerDatabase,
  volunteerDb,
} from "./db";
import { queueCommand } from "./localStore";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("volunteer replica", () => {
  beforeEach(async () => {
    const db = volunteerDb();
    await db.delete();
    await db.open();
  });

  it("writes rows and the cursor together", async () => {
    await applyChanges(
      ORG,
      [
        {
          sequence: 7,
          entity: "shifts",
          id: "shift-1",
          operation: "insert",
          payload: { id: "shift-1", title: "Pantry" },
        },
      ],
      7,
    );
    expect(await readCursor(ORG)).toBe(7);
    expect(await entityById(ORG, "shifts", "shift-1")).toMatchObject({ title: "Pantry" });
  });

  it("leaves the cursor untouched when the batch cannot be written", async () => {
    await applyChanges(
      ORG,
      [
        {
          sequence: 3,
          entity: "shifts",
          id: "shift-1",
          operation: "insert",
          payload: { id: "shift-1" },
        },
      ],
      3,
    );

    // A function cannot be structured-cloned, so IndexedDB aborts the
    // transaction. A crash mid-batch must look the same: no rows, old cursor.
    await expect(
      applyChanges(
        ORG,
        [
          {
            sequence: 8,
            entity: "shifts",
            id: "shift-2",
            operation: "insert",
            payload: { id: "shift-2", broken: () => undefined },
          },
        ],
        8,
      ),
    ).rejects.toBeTruthy();

    expect(await readCursor(ORG)).toBe(3);
    expect(await entityById(ORG, "shifts", "shift-2")).toBeNull();
    expect(await entitiesOf(ORG, "shifts")).toHaveLength(1);
  });

  it("removes a row when its tombstone arrives", async () => {
    await applyChanges(
      ORG,
      [
        {
          sequence: 1,
          entity: "registrations",
          id: "reg-1",
          operation: "insert",
          payload: { id: "reg-1" },
        },
      ],
      1,
    );
    await applyChanges(
      ORG,
      [{ sequence: 2, entity: "registrations", id: "reg-1", operation: "delete" }],
      2,
    );
    expect(await entityById(ORG, "registrations", "reg-1")).toBeNull();
    expect(await readCursor(ORG)).toBe(2);
  });

  it("keeps an unsent command, and its owner, across a fresh database handle", async () => {
    await queueCommand({
      userId: "user-alice",
      organizationId: ORG,
      membershipEpoch: 2,
      command: "REGISTER_FOR_SHIFT",
      payload: { shiftId: "shift-1", volunteerId: "vol-1" },
    });

    const reopened = new VolunteerDatabase();
    try {
      const rows = await reopened.outbox.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe("pending");
      expect(rows[0]?.userId).toBe("user-alice");
      expect(rows[0]?.envelope.payload.membershipEpoch).toBe(2);
      expect(rows[0]?.envelope.organizationId).toBe(ORG);
    } finally {
      reopened.close();
    }
  });
});
