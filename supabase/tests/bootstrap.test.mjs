import assert from "node:assert/strict";
import test from "node:test";

import { asUser, createDatabase, ids, pull, query, seed, sendCommand } from "./harness.mjs";

async function bootstrap(db, userId, organizationId = ids.orgA) {
  return asUser(db, userId, async () => {
    const rows = await query(db, "select public.bootstrap_workspace($1::uuid) as result", [
      organizationId,
    ]);
    return rows[0].result;
  });
}

/** Applies every change from zero, keeping the latest row per entity. */
async function replay(db, userId, organizationId = ids.orgA) {
  const state = new Map();
  let cursor = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await pull(db, userId, organizationId, cursor, 100);
    for (const change of result.changes) {
      if (!state.has(change.entity)) state.set(change.entity, new Map());
      const rows = state.get(change.entity);
      if (change.operation === "delete") rows.delete(change.id);
      else rows.set(change.id, change.payload);
    }
    if (!result.hasMore) return state;
    assert.ok(result.cursor > cursor, "a non-final batch must advance the cursor");
    cursor = result.cursor;
  }
  throw new Error("pull did not finish within 20 batches");
}

test("a coordinator bootstraps the current organization, not its history", async () => {
  const db = await createDatabase();
  await seed(db);

  const result = await bootstrap(db, ids.coordinatorA);
  assert.equal(result.status, "ok");
  assert.ok(result.cursor > 0);
  assert.ok(result.revision >= 1);

  assert.equal(result.entities.organization.length, 1);
  assert.equal(result.entities.organization[0].name, "Rivergate Kitchen");
  assert.equal(result.entities.opportunity.length, 1);
  assert.equal(result.entities.opportunity[0].id, ids.opportunityA);
  assert.equal(result.entities.shift.length, 4);
  assert.equal(result.entities.volunteer.length, 2);
  assert.equal(result.entities.membership.length, 4);
  assert.equal(result.entities.credential_type.length, 1);

  // Nothing from the other organization can leak through a bootstrap.
  const serialized = JSON.stringify(result.entities);
  assert.equal(serialized.includes(ids.orgB), false);
  assert.equal(serialized.includes("Harbor Lights"), false);

  await db.close();
});

test("a volunteer only receives rows the read policies allow", async () => {
  const db = await createDatabase();
  await seed(db);

  const result = await bootstrap(db, ids.volunteerUserA);
  assert.equal(result.status, "ok");
  assert.equal(result.entities.volunteer.length, 1);
  assert.equal(result.entities.volunteer[0].id, ids.volunteerA);
  assert.equal(result.entities.shift.length, 4);
  assert.equal(result.entities.membership.length, 1);
  assert.equal(result.entities.registration.length, 0);

  await db.close();
});

test("a non-member is refused without revealing whether the organization exists", async () => {
  const db = await createDatabase();
  await seed(db);

  const result = await bootstrap(db, ids.ownerB, ids.orgA);
  assert.deepEqual(result, { status: "forbidden" });

  await db.close();
});

test("bootstrap and a full replay produce the same visible state", async () => {
  const db = await createDatabase();
  await seed(db);

  const snapshot = await bootstrap(db, ids.coordinatorA);
  const replayed = await replay(db, ids.coordinatorA);

  for (const [entity, rows] of Object.entries(snapshot.entities)) {
    const current = replayed.get(entity) ?? new Map();
    const bootstrapped = new Map(rows.map((row) => [row.id, row]));
    assert.deepEqual(
      [...current.keys()].sort(),
      [...bootstrapped.keys()].sort(),
      `${entity} ids differ between bootstrap and replay`,
    );
    for (const [id, row] of bootstrapped) {
      assert.equal(current.get(id).row_version, row.row_version, `${entity}/${id} version`);
    }
  }

  // Nothing in the change log is outside the bootstrap's visible set.
  for (const [entity, rows] of replayed) {
    const bootstrapped = new Map((snapshot.entities[entity] ?? []).map((row) => [row.id, row]));
    for (const id of rows.keys()) assert.ok(bootstrapped.has(id), `${entity}/${id} is extra`);
  }

  await db.close();
});

test("the bootstrap cursor is the boundary for later changes", async () => {
  const db = await createDatabase();
  await seed(db);

  const snapshot = await bootstrap(db, ids.coordinatorA);
  const created = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_SHIFT",
    payload: {
      opportunityId: ids.opportunityA,
      startsAt: new Date(Date.now() + 120 * 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 123 * 3600_000).toISOString(),
      capacity: 3,
      roles: [{ name: "Sorter", required: 1 }],
    },
  });
  assert.equal(created.status, "applied");

  const later = await pull(db, ids.coordinatorA, ids.orgA, snapshot.cursor, 100);
  assert.equal(later.status, "ok");
  assert.ok(later.cursor > snapshot.cursor);
  const shift = later.changes.find(
    (change) =>
      change.entity === "shift" && change.id === created.data.id && change.operation === "insert",
  );
  assert.ok(shift, "the new shift is the first thing after the bootstrap cursor");
  assert.equal(shift.payload.capacity, 3);

  await db.close();
});
