import assert from "node:assert/strict";
import test from "node:test";

import {
  asOwner,
  asUser,
  createDatabase,
  ids,
  pull,
  query,
  seed,
  sendCommand,
} from "./harness.mjs";

async function fresh() {
  const db = await createDatabase();
  await seed(db);
  return db;
}

test("a command against another organization is refused and writes nothing", async () => {
  const db = await fresh();

  const response = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgB,
    command: "CREATE_OPPORTUNITY",
    payload: { title: "Hostile insert", slug: "hostile" },
  });
  assert.equal(response.status, "forbidden");
  assert.equal(response.code, "not_a_member");

  const [count] = await query(
    db,
    "select count(*)::int as n from public.opportunities where organization_id = $1",
    [ids.orgB],
  );
  assert.equal(count.n, 1);

  await db.close();
});

test("a revoked coordinator's queued command is stale authority, not a retry", async () => {
  const db = await fresh();

  const first = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_OPPORTUNITY",
    payload: { title: "Authorized Work", slug: "authorized-work" },
  });
  assert.equal(first.status, "applied");

  await asOwner(db, () =>
    query(
      db,
      "update public.organization_memberships set status = 'disabled' where organization_id = $1 and user_id = $2",
      [ids.orgA, ids.coordinatorA],
    ),
  );

  const queued = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_OPPORTUNITY",
    payload: { title: "Offline Work", slug: "offline-work", membershipEpoch: 1 },
  });
  assert.equal(queued.status, "stale_authority");
  assert.equal(queued.code, "stale_authority");

  const [count] = await query(
    db,
    "select count(*)::int as n from public.opportunities where slug = 'offline-work'",
  );
  assert.equal(count.n, 0);

  await db.close();
});

test("a volunteer cannot use a coordinator command", async () => {
  const db = await fresh();

  for (const command of [
    "CREATE_SHIFT",
    "CREATE_SHIFT_SERIES",
    "REVIEW_HOURS",
    "APPLY_ROSTER_PLAN",
  ]) {
    const response = await sendCommand(db, ids.volunteerUserA, {
      organizationId: ids.orgA,
      command,
      payload: {},
    });
    assert.equal(response.status, "forbidden", command);
  }

  await db.close();
});

test("a volunteer cannot act on another volunteer's record", async () => {
  const db = await fresh();

  const response = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftOpen, volunteerId: ids.volunteerA2 },
  });
  assert.equal(response.status, "forbidden");

  const [count] = await query(
    db,
    "select count(*)::int as n from public.registrations where shift_id = $1",
    [ids.shiftOpen],
  );
  assert.equal(count.n, 0);

  await db.close();
});

test("a volunteer cannot pull, read or write another organization", async () => {
  const db = await fresh();

  const pullB = await pull(db, ids.volunteerUserA, ids.orgB);
  assert.equal(pullB.status, "forbidden");

  const workspace = await asUser(db, ids.volunteerUserA, () =>
    query(db, "select public.my_workspaces() as result"),
  );
  const workspaces = workspace[0].result.workspaces;
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].organizationId, ids.orgA);
  assert.equal(workspaces[0].role, "volunteer");
  assert.equal(workspaces[0].volunteerId, ids.volunteerA);

  await db.close();
});

test("a stale row version is reported with the authoritative version", async () => {
  const db = await fresh();

  const [before] = await query(db, "select row_version from public.shifts where id = $1", [
    ids.shiftOpen,
  ]);

  const update = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "UPDATE_SHIFT",
    versions: { [ids.shiftOpen]: Number(before.row_version) },
    payload: { id: ids.shiftOpen, capacity: 6 },
  });
  assert.equal(update.status, "applied");

  const stale = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "UPDATE_SHIFT",
    versions: { [ids.shiftOpen]: Number(before.row_version) },
    payload: { id: ids.shiftOpen, capacity: 7 },
  });
  assert.equal(stale.status, "conflict");
  assert.equal(stale.code, "row_version_conflict");
  assert.equal(stale.authoritative.rowVersion, Number(before.row_version) + 1);

  const [after] = await query(db, "select capacity from public.shifts where id = $1", [
    ids.shiftOpen,
  ]);
  assert.equal(after.capacity, 6);

  await db.close();
});

test("seat counts cannot be pushed past capacity by a capacity edit", async () => {
  const db = await fresh();

  await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftSingle },
  });

  const shrink = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "UPDATE_SHIFT",
    payload: { id: ids.shiftSingle, capacity: 0 },
  });
  assert.equal(shrink.status, "conflict");
  assert.equal(shrink.code, "capacity_below_confirmed");

  await db.close();
});
