import assert from "node:assert/strict";
import test from "node:test";

import { asOwner, createDatabase, ids, pull, query, seed, sendCommand } from "./harness.mjs";

async function fresh() {
  const db = await createDatabase();
  await seed(db);
  return db;
}

test("the change log advances a cursor and stops when caught up", async () => {
  const db = await fresh();

  const first = await pull(db, ids.coordinatorA, ids.orgA);
  assert.equal(first.status, "ok");
  assert.ok(first.changes.length > 0);
  assert.ok(first.cursor > 0);

  const second = await pull(db, ids.coordinatorA, ids.orgA, first.cursor);
  assert.equal(second.changes.length, 0);
  assert.equal(Number(second.cursor), Number(first.cursor));

  await db.close();
});

test("a pull carries the rows, not just the change ids", async () => {
  const db = await fresh();

  const page = await pull(db, ids.coordinatorA, ids.orgA);
  const shift = page.changes.find(
    (change) => change.entity === "shift" && change.id === ids.shiftOpen,
  );
  assert.ok(shift, "shift change is in the page");
  assert.equal(shift.payload.id, ids.shiftOpen);
  assert.equal(shift.payload.capacity, 5);

  await db.close();
});

test("a volunteer receives opportunities and shifts but not other volunteers", async () => {
  const db = await fresh();

  await sendCommand(db, ids.volunteerUserA2, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftOpen },
  });

  const page = await pull(db, ids.volunteerUserA, ids.orgA);
  const volunteers = page.changes.filter((change) => change.entity === "volunteer");
  assert.deepEqual(
    volunteers.map((change) => change.id),
    [ids.volunteerA],
  );

  const registrations = page.changes.filter((change) => change.entity === "registration");
  assert.equal(registrations.length, 0, "another volunteer's seat is invisible");

  const shifts = page.changes.filter((change) => change.entity === "shift");
  assert.ok(shifts.length > 0, "the schedule itself is visible");

  await db.close();
});

test("an invisible change is skipped without stalling the cursor", async () => {
  const db = await fresh();

  const start = await pull(db, ids.volunteerUserA, ids.orgA);

  // Applications are coordinator-only, so this change exists in the log but
  // resolves to nothing for a volunteer.
  await asOwner(db, () =>
    query(
      db,
      `insert into public.applications (organization_id, name, email, stage)
       values ($1, 'Hannah Hopeful', 'hannah@example.org', 'applied')`,
      [ids.orgA],
    ),
  );

  const page = await pull(db, ids.volunteerUserA, ids.orgA, start.cursor);
  assert.equal(page.changes.length, 0);
  assert.ok(Number(page.cursor) > Number(start.cursor), "cursor still advanced");

  // The next visible change must still arrive.
  await asOwner(db, () =>
    query(
      db,
      `insert into public.notifications
         (organization_id, kind, title, body, audience, volunteer_id)
       values ($1, 'reminder', 'Pantry tomorrow', 'See you at 9', 'volunteer', $2)`,
      [ids.orgA, ids.volunteerA],
    ),
  );

  const next = await pull(db, ids.volunteerUserA, ids.orgA, page.cursor);
  assert.equal(next.changes.length, 1);
  assert.equal(next.changes[0].entity, "notification");

  await db.close();
});

test("a deleted row arrives as a tombstone", async () => {
  const db = await fresh();

  const before = await pull(db, ids.coordinatorA, ids.orgA);

  await asOwner(db, () => query(db, "delete from public.shifts where id = $1", [ids.shiftPast]));

  const page = await pull(db, ids.coordinatorA, ids.orgA, before.cursor);
  const tombstone = page.changes.find(
    (change) => change.entity === "shift" && change.id === ids.shiftPast,
  );
  assert.ok(tombstone);
  assert.equal(tombstone.operation, "delete");
  assert.equal(tombstone.payload, undefined);

  await db.close();
});

test("one hundred retries of one operation produce one registration", async () => {
  const db = await fresh();

  const operationId = "99999999-9999-4999-8999-999999999999";
  const responses = [];

  for (let attempt = 0; attempt < 100; attempt += 1) {
    responses.push(
      await sendCommand(db, ids.volunteerUserA, {
        organizationId: ids.orgA,
        command: "REGISTER_FOR_SHIFT",
        payload: { shiftId: ids.shiftOpen },
        operationId,
      }),
    );
  }

  assert.equal(responses[0].status, "applied");
  assert.ok(responses.slice(1).every((response) => response.status === "already_applied"));

  const [count] = await query(
    db,
    "select count(*)::int as n from public.registrations where shift_id = $1",
    [ids.shiftOpen],
  );
  assert.equal(count.n, 1);

  const [ledger] = await query(
    db,
    "select count(*)::int as n from sync.processed_operations where operation_id = $1",
    [operationId],
  );
  assert.equal(ledger.n, 1);

  await db.close();
});

test("the same operation id cannot be replayed into a different command", async () => {
  const db = await fresh();

  const operationId = "88888888-8888-4888-8888-888888888888";
  const register = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftOpen },
    operationId,
  });
  assert.equal(register.status, "applied");

  const replay = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CANCEL_REGISTRATION",
    payload: { shiftId: ids.shiftOpen },
    operationId,
  });
  assert.equal(replay.status, "already_applied");

  const [registration] = await query(
    db,
    "select status from public.registrations where shift_id = $1 and volunteer_id = $2",
    [ids.shiftOpen, ids.volunteerA],
  );
  assert.equal(registration.status, "registered");

  await db.close();
});

test("change rows never cross organizations", async () => {
  const db = await fresh();

  const pageB = await pull(db, ids.ownerB, ids.orgB);
  const entities = pageB.changes.map((change) => change.id);
  assert.ok(!entities.includes(ids.shiftOpen));
  assert.ok(!entities.includes(ids.volunteerA));

  await db.close();
});
