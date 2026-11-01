import assert from "node:assert/strict";
import test from "node:test";

import { createDatabase, ids, pull, query, seed, sendCommand } from "./harness.mjs";

async function fresh() {
  const db = await createDatabase();
  await seed(db);
  return db;
}

test("a namespaced entity version refuses a stale edit", async () => {
  const db = await fresh();

  // The wire format is `entity:<uuid>` and the contract fixtures require it.
  // Reading only the bare uuid made every guard a no-op.
  const stale = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "UPDATE_SHIFT",
    payload: { id: ids.shiftOpen, capacity: 9 },
    versions: { [`shift:${ids.shiftOpen}`]: 999 },
  });

  assert.equal(stale.status, "conflict");
  assert.equal(stale.code, "row_version_conflict");

  const [row] = await query(db, "select capacity from public.shifts where id = $1", [
    ids.shiftOpen,
  ]);
  assert.equal(row.capacity, 5);

  await db.close();
});

test("a coordinator replaces a volunteer's skills and the change log carries deletes", async () => {
  const db = await fresh();

  const first = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "SET_VOLUNTEER_SKILLS",
    payload: {
      volunteerId: ids.volunteerA,
      skills: ["Packing", "Driving", "Packing"],
    },
  });
  assert.equal(first.status, "applied");

  const saved = await query(
    db,
    "select skill from public.volunteer_skills where volunteer_id = $1 order by skill",
    [ids.volunteerA],
  );
  assert.deepEqual(
    saved.map((row) => row.skill),
    ["Driving", "Packing"],
  );

  const second = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "SET_VOLUNTEER_SKILLS",
    payload: { volunteerId: ids.volunteerA, skills: ["Driving"] },
  });
  assert.equal(second.status, "applied");

  const remaining = await query(
    db,
    "select skill from public.volunteer_skills where volunteer_id = $1",
    [ids.volunteerA],
  );
  assert.deepEqual(
    remaining.map((row) => row.skill),
    ["Driving"],
  );

  const other = await sendCommand(db, ids.volunteerUserA2, {
    organizationId: ids.orgA,
    command: "SET_VOLUNTEER_SKILLS",
    payload: { volunteerId: ids.volunteerA, skills: ["Borrowed"] },
  });
  assert.equal(other.status, "forbidden");

  const changes = await pull(db, ids.coordinatorA, ids.orgA, 0, 1000);
  const skillChanges = changes.changes.filter((change) => change.entity === "volunteer_skill");
  assert.ok(skillChanges.some((change) => change.operation === "delete"));
  assert.ok(skillChanges.some((change) => change.operation === "insert"));

  await db.close();
});

test("a volunteer can change their own availability but not another volunteer's", async () => {
  const db = await fresh();

  const mine = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "SET_VOLUNTEER_AVAILABILITY",
    payload: {
      volunteerId: ids.volunteerA,
      slots: [
        { day: "mon", period: "morning" },
        { day: "mon", period: "evening" },
      ],
    },
  });
  assert.equal(mine.status, "applied");

  const rules = await query(
    db,
    "select day, period from public.availability_rules where volunteer_id = $1 order by day, period",
    [ids.volunteerA],
  );
  assert.deepEqual(
    rules.map((row) => `${row.day}:${row.period}`),
    ["mon:evening", "mon:morning"],
  );

  const replaced = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "SET_VOLUNTEER_AVAILABILITY",
    payload: {
      volunteerId: ids.volunteerA,
      slots: [{ day: "wed", period: "afternoon" }],
    },
  });
  assert.equal(replaced.status, "applied");

  const after = await query(
    db,
    "select day, period from public.availability_rules where volunteer_id = $1",
    [ids.volunteerA],
  );
  assert.deepEqual(after, [{ day: "wed", period: "afternoon" }]);

  const other = await sendCommand(db, ids.volunteerUserA2, {
    organizationId: ids.orgA,
    command: "SET_VOLUNTEER_AVAILABILITY",
    payload: { volunteerId: ids.volunteerA, slots: [] },
  });
  assert.equal(other.status, "forbidden");
  assert.equal(other.code, "forbidden");

  const invalid = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "SET_VOLUNTEER_AVAILABILITY",
    payload: {
      volunteerId: ids.volunteerA,
      slots: [{ day: "mon", period: "midnight" }],
    },
  });
  assert.equal(invalid.status, "validation_error");

  await db.close();
});

test("a coordinator takes a volunteer off the roster with status, guarded by the row version", async () => {
  const db = await fresh();

  const [row] = await query(db, "select row_version from public.volunteers where id = $1", [
    ids.volunteerA,
  ]);

  const saved = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "SAVE_VOLUNTEER_PROFILE",
    payload: { volunteerId: ids.volunteerA, status: "inactive", phone: "555-7777" },
    versions: { [`volunteer:${ids.volunteerA}`]: row.row_version },
  });
  assert.equal(saved.status, "applied");

  const [updated] = await query(db, "select status, phone from public.volunteers where id = $1", [
    ids.volunteerA,
  ]);
  assert.equal(updated.status, "inactive");
  assert.equal(updated.phone, "555-7777");

  const stale = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "SAVE_VOLUNTEER_PROFILE",
    payload: { volunteerId: ids.volunteerA, phone: "555-0000" },
    versions: { [`volunteer:${ids.volunteerA}`]: row.row_version },
  });
  assert.equal(stale.status, "conflict");
  assert.equal(stale.code, "row_version_conflict");

  const invalid = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "SAVE_VOLUNTEER_PROFILE",
    payload: { volunteerId: ids.volunteerA, status: "retired" },
  });
  assert.equal(invalid.status, "validation_error");

  const other = await sendCommand(db, ids.volunteerUserA2, {
    organizationId: ids.orgA,
    command: "SAVE_VOLUNTEER_PROFILE",
    payload: { volunteerId: ids.volunteerA, status: "inactive" },
  });
  assert.equal(other.status, "forbidden");

  // A volunteer cannot put themselves back on the roster after a coordinator
  // took them off it, even though they may edit their own contact details.
  const selfReactivate = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "SAVE_VOLUNTEER_PROFILE",
    payload: { volunteerId: ids.volunteerA, status: "active" },
  });
  assert.equal(selfReactivate.status, "forbidden");

  await db.close();
});

test("credential types are coordinator-created and unique by name", async () => {
  const db = await fresh();

  const created = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_CREDENTIAL_TYPE",
    payload: { name: "Safe driver", validityMonths: 12 },
  });
  assert.equal(created.status, "applied");
  assert.ok(created.data.id);

  const [row] = await query(
    db,
    "select name, validity_months from public.credential_types where id = $1",
    [created.data.id],
  );
  assert.equal(row.name, "Safe driver");
  assert.equal(row.validity_months, 12);

  const duplicate = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_CREDENTIAL_TYPE",
    payload: { name: "Safe Driver", validityMonths: 24 },
  });
  assert.equal(duplicate.status, "validation_error");
  assert.equal(duplicate.code, "credential_type_exists");

  const forbidden = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CREATE_CREDENTIAL_TYPE",
    payload: { name: "Backstage pass", validityMonths: 6 },
  });
  assert.equal(forbidden.status, "forbidden");

  await db.close();
});

test("a coordinator verifies a credential and a stale edit is refused", async () => {
  const db = await fresh();

  const created = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "UPDATE_CREDENTIAL",
    payload: {
      volunteerId: ids.volunteerA,
      credentialTypeId: ids.credentialTypeA,
      identifier: "FH-200",
      validThrough: "2027-10-31",
      verified: true,
    },
  });
  assert.equal(created.status, "applied");

  const [row] = await query(
    db,
    "select verified_at, row_version from public.volunteer_credentials where id = $1",
    [created.data.id],
  );
  assert.ok(row.verified_at);

  const stale = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "UPDATE_CREDENTIAL",
    payload: {
      id: created.data.id,
      volunteerId: ids.volunteerA,
      credentialTypeId: ids.credentialTypeA,
      identifier: "FH-300",
    },
    versions: { [`credential:${created.data.id}`]: row.row_version - 1 },
  });
  assert.equal(stale.status, "conflict");
  assert.equal(stale.code, "row_version_conflict");

  await db.close();
});
