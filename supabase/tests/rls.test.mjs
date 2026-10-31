import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { asAnon, asUser, createDatabase, ids, issueCheckinCode, query, seed } from "./harness.mjs";

let db;

before(async () => {
  db = await createDatabase();
  await seed(db);
});

after(async () => {
  await db?.close();
});

test("a volunteer reads their own roster row and no other", async () => {
  const rows = await asUser(db, ids.volunteerUserA, () =>
    query(db, "select id, name from public.volunteers order by name"),
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    [ids.volunteerA],
  );
});

test("a coordinator reads the whole roster in their organization", async () => {
  const rows = await asUser(db, ids.coordinatorA, () =>
    query(db, "select id from public.volunteers order by name"),
  );
  assert.equal(rows.length, 2);
});

test("an organization member cannot read another organization", async () => {
  const volunteers = await asUser(db, ids.volunteerUserA, () =>
    query(db, "select id from public.volunteers where organization_id = $1", [ids.orgB]),
  );
  assert.equal(volunteers.length, 0);

  const organizations = await asUser(db, ids.volunteerUserA, () =>
    query(db, "select id from public.organizations order by name"),
  );
  assert.deepEqual(
    organizations.map((row) => row.id),
    [ids.orgA],
  );

  const shifts = await asUser(db, ids.ownerA, () =>
    query(db, "select id from public.shifts where organization_id = $1", [ids.orgB]),
  );
  assert.equal(shifts.length, 0);
});

test("an anonymous request reads nothing and cannot even select", async () => {
  await assert.rejects(
    asAnon(db, () => query(db, "select id from public.organizations")),
    /permission denied/i,
  );
});

test("writes are refused at the grant layer, not only by a policy", async () => {
  await assert.rejects(
    asUser(db, ids.volunteerUserA, () =>
      query(
        db,
        `insert into public.registrations (organization_id, shift_id, volunteer_id, role)
         values ($1, $2, $3, 'Packer')`,
        [ids.orgA, ids.shiftOpen, ids.volunteerA],
      ),
    ),
    /permission denied/i,
  );

  await assert.rejects(
    asUser(db, ids.coordinatorA, () =>
      query(db, "update public.shifts set capacity = 99 where id = $1", [ids.shiftOpen]),
    ),
    /permission denied/i,
  );
});

test("another volunteer's hours and attendance are invisible", async () => {
  const hours = await asUser(db, ids.volunteerUserA2, () =>
    query(db, "select id from public.hour_entries where volunteer_id = $1", [ids.volunteerA]),
  );
  assert.equal(hours.length, 0);

  const attendance = await asUser(db, ids.volunteerUserA2, () =>
    query(db, "select id from public.attendance_events where volunteer_id = $1", [ids.volunteerA]),
  );
  assert.equal(attendance.length, 0);
});

test("check-in codes are staff-only", async () => {
  await issueCheckinCode(db, ids.shiftOpen, { code: "909090", token: "tok-rls" });

  const asVolunteer = await asUser(db, ids.volunteerUserA, () =>
    query(db, "select id from public.checkin_codes"),
  );
  assert.equal(asVolunteer.length, 0);

  const asCoordinator = await asUser(db, ids.coordinatorA, () =>
    query(db, "select id from public.checkin_codes"),
  );
  assert.equal(asCoordinator.length, 1);
});

test("audit and activity feeds stay with coordinators", async () => {
  const asVolunteer = await asUser(db, ids.volunteerUserA, () =>
    query(db, "select id from public.audit_events"),
  );
  assert.equal(asVolunteer.length, 0);
});

test("a disabled member loses every read", async () => {
  await asOwnerRls(() =>
    query(
      db,
      "update public.organization_memberships set status = 'disabled' where organization_id = $1 and user_id = $2",
      [ids.orgA, ids.volunteerUserA2],
    ),
  );

  const rows = await asUser(db, ids.volunteerUserA2, () =>
    query(db, "select id from public.volunteers"),
  );
  assert.equal(rows.length, 0);
});

async function asOwnerRls(work) {
  const { asOwner } = await import("./harness.mjs");
  return asOwner(db, work);
}
