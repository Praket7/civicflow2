import assert from "node:assert/strict";
import test from "node:test";

import {
  asOwner,
  createDatabase,
  ids,
  issueCheckinCode,
  query,
  seed,
  sendCommand,
} from "./harness.mjs";

async function fresh() {
  const db = await createDatabase();
  await seed(db);
  return db;
}

test("a coordinator creates an opportunity and a shift with roles", async () => {
  const db = await fresh();

  const opportunity = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_OPPORTUNITY",
    payload: {
      slug: "sunday-soup",
      title: "Sunday Soup",
      cause: "Hunger",
      capacity: 10,
      description: "Serve soup",
    },
  });
  assert.equal(opportunity.status, "applied");
  const newOpportunity = opportunity.data.id;
  assert.ok(newOpportunity);

  const shift = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_SHIFT",
    payload: {
      opportunityId: newOpportunity,
      startsAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 75 * 3600_000).toISOString(),
      capacity: 4,
      roles: [{ name: "Server", required: 2 }],
    },
  });
  assert.equal(shift.status, "applied");

  const [created] = await query(db, "select capacity from public.shifts where id = $1", [
    shift.data.id,
  ]);
  assert.equal(created.capacity, 4);

  await db.close();
});

test("a volunteer registers, sees a confirmed seat, and a repeat is a no-op", async () => {
  const db = await fresh();

  const first = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftOpen, role: "Packer" },
  });
  assert.equal(first.status, "applied");

  const [shift] = await query(db, "select confirmed from public.shifts where id = $1", [
    ids.shiftOpen,
  ]);
  assert.equal(shift.confirmed, 1);

  const [attendance] = await query(
    db,
    "select status from public.attendance_events where shift_id = $1 and volunteer_id = $2",
    [ids.shiftOpen, ids.volunteerA],
  );
  assert.equal(attendance.status, "expected");

  const again = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftOpen, role: "Packer" },
  });
  assert.equal(again.status, "applied");
  assert.equal(again.data.noOp, true);

  const [count] = await query(
    db,
    "select count(*)::int as n from public.registrations where shift_id = $1",
    [ids.shiftOpen],
  );
  assert.equal(count.n, 1);

  await db.close();
});

test("the last seat goes to one volunteer and the other is waitlisted", async () => {
  const db = await fresh();

  const alice = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftSingle },
  });
  assert.equal(alice.status, "applied");

  const bob = await sendCommand(db, ids.volunteerUserA2, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftSingle },
  });
  assert.equal(bob.status, "conflict");
  assert.equal(bob.code, "capacity_full");

  const bobWaitlisted = await sendCommand(db, ids.volunteerUserA2, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftSingle, allowWaitlist: true },
  });
  assert.equal(bobWaitlisted.status, "applied");
  assert.equal(bobWaitlisted.data.waitlisted, true);

  const [shift] = await query(
    db,
    "select capacity, confirmed, waitlisted from public.shifts where id = $1",
    [ids.shiftSingle],
  );
  assert.deepEqual(shift, { capacity: 1, confirmed: 1, waitlisted: 1 });

  const cancel = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CANCEL_REGISTRATION",
    payload: { shiftId: ids.shiftSingle },
  });
  assert.equal(cancel.status, "applied");
  assert.equal(cancel.data.promoted, ids.volunteerA2);

  const [after] = await query(
    db,
    "select capacity, confirmed, waitlisted from public.shifts where id = $1",
    [ids.shiftSingle],
  );
  assert.deepEqual(after, { capacity: 1, confirmed: 1, waitlisted: 0 });

  const [seats] = await query(
    db,
    `select volunteer_id, status from public.registrations
     where shift_id = $1 and status in ('registered', 'confirmed')`,
    [ids.shiftSingle],
  );
  assert.equal(seats.volunteer_id, ids.volunteerA2);

  await db.close();
});

test("check-in opens an hour before and requires the current code", async () => {
  const db = await fresh();

  await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftSoon },
  });

  const early = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CHECK_IN",
    payload: { shiftId: ids.shiftSoon, code: "000000" },
  });
  assert.equal(early.status, "validation_error");
  assert.equal(early.code, "invalid_code");

  await issueCheckinCode(db, ids.shiftSoon, { code: "424242", token: "tok-suite" });

  const checkedIn = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CHECK_IN",
    payload: { shiftId: ids.shiftSoon, code: "424242" },
  });
  assert.equal(checkedIn.status, "applied");

  // The code is a one-time capability. Replaying it after it was consumed must
  // fail even for the same volunteer.
  const replay = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CHECK_IN",
    payload: { shiftId: ids.shiftSoon, code: "424242" },
  });
  assert.equal(replay.status, "validation_error");
  assert.equal(replay.code, "invalid_code");

  const checkedOut = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CHECK_OUT",
    payload: { shiftId: ids.shiftSoon },
  });
  assert.equal(checkedOut.status, "applied");
  assert.ok(checkedOut.data.minutes >= 1);

  const [attendance] = await query(
    db,
    "select status from public.attendance_events where shift_id = $1 and volunteer_id = $2",
    [ids.shiftSoon, ids.volunteerA],
  );
  assert.equal(attendance.status, "completed");

  const [hours] = await query(
    db,
    "select status, minutes from public.hour_entries where source_shift_id = $1",
    [ids.shiftSoon],
  );
  assert.equal(hours.status, "pending");

  const review = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "REVIEW_HOURS",
    payload: { hourEntryId: checkedOut.data.hourEntryId, status: "verified" },
  });
  assert.equal(review.status, "applied");

  const [volunteer] = await query(
    db,
    "select hours_verified from public.volunteers where id = $1",
    [ids.volunteerA],
  );
  assert.ok(Number(volunteer.hours_verified) > 0);

  await db.close();
});

test("check-in is refused before the window opens and after the shift ends", async () => {
  const db = await fresh();

  const future = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftOpen },
  });
  assert.equal(future.status, "applied");

  const tooEarly = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CHECK_IN",
    payload: { shiftId: ids.shiftOpen },
  });
  assert.equal(tooEarly.code, "check_in_not_open");

  const late = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CHECK_IN",
    payload: { shiftId: ids.shiftPast },
  });
  assert.equal(late.code, "check_in_closed");

  await db.close();
});

test("a coordinator check-in does not need a code, and a no-show is recorded", async () => {
  const db = await fresh();

  await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftSoon },
  });

  const manual = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CHECK_IN",
    payload: { shiftId: ids.shiftSoon, volunteerId: ids.volunteerA },
  });
  assert.equal(manual.status, "applied");

  const noShow = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "MARK_NO_SHOW",
    payload: { shiftId: ids.shiftSoon, volunteerId: ids.volunteerA },
  });
  assert.equal(noShow.status, "applied");

  const [attendance] = await query(
    db,
    "select status from public.attendance_events where shift_id = $1 and volunteer_id = $2",
    [ids.shiftSoon, ids.volunteerA],
  );
  assert.equal(attendance.status, "no_show");

  const [registration] = await query(
    db,
    "select status from public.registrations where shift_id = $1 and volunteer_id = $2",
    [ids.shiftSoon, ids.volunteerA],
  );
  assert.equal(registration.status, "no_show");

  await db.close();
});

test("a volunteer can save their profile and add a credential", async () => {
  const db = await fresh();

  const profile = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "SAVE_VOLUNTEER_PROFILE",
    payload: { phone: "555-9999", interests: "Pantry packing", languages: ["English", "Spanish"] },
  });
  assert.equal(profile.status, "applied");

  const [saved] = await query(db, "select phone, languages from public.volunteers where id = $1", [
    ids.volunteerA,
  ]);
  assert.equal(saved.phone, "555-9999");
  assert.deepEqual(saved.languages, ["English", "Spanish"]);

  const credential = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "UPDATE_CREDENTIAL",
    payload: {
      credentialTypeId: ids.credentialTypeA,
      identifier: "FH-100",
      validThrough: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
    },
  });
  assert.equal(credential.status, "applied");
  assert.ok(credential.data.id);

  await db.close();
});

test("a stale AutoRoster plan is refused with zero partial assignments", async () => {
  const db = await fresh();

  await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "UPDATE_ROSTER_POLICY",
    payload: { policy: { maxHoursPerWeek: 12 } },
  });

  const [revisionRow] = await query(
    db,
    "select revision from public.organization_revisions where organization_id = $1",
    [ids.orgA],
  );
  const revision = Number(revisionRow.revision);
  assert.ok(revision > 1);

  const stale = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "APPLY_ROSTER_PLAN",
    baseRevision: revision - 1,
    payload: {
      assignments: [{ shiftId: ids.shiftOpen, volunteerId: ids.volunteerA, role: "Packer" }],
    },
  });
  assert.equal(stale.status, "stale_plan");
  assert.equal(stale.code, "plan_stale");

  const [none] = await query(
    db,
    "select count(*)::int as n from public.registrations where shift_id = $1",
    [ids.shiftOpen],
  );
  assert.equal(none.n, 0);

  const applied = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "APPLY_ROSTER_PLAN",
    baseRevision: revision,
    payload: {
      assignments: [{ shiftId: ids.shiftOpen, volunteerId: ids.volunteerA, role: "Packer" }],
    },
  });
  assert.equal(applied.status, "applied");
  assert.equal(applied.data.assigned, 1);

  await db.close();
});

test("a locked assignment cannot be moved by a plan", async () => {
  const db = await fresh();

  await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftOpen, role: "Packer" },
  });

  await asOwner(db, () =>
    query(
      db,
      "update public.registrations set locked = true, locked_at = now() where shift_id = $1 and volunteer_id = $2",
      [ids.shiftOpen, ids.volunteerA],
    ),
  );

  const [revisionRow] = await query(
    db,
    "select revision from public.organization_revisions where organization_id = $1",
    [ids.orgA],
  );

  const attempt = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "APPLY_ROSTER_PLAN",
    baseRevision: Number(revisionRow.revision),
    payload: {
      assignments: [{ shiftId: ids.shiftOpen, volunteerId: ids.volunteerA, role: "Greeter" }],
    },
  });
  assert.equal(attempt.status, "conflict");
  assert.equal(attempt.code, "assignment_locked");

  await db.close();
});

test("canceling a shift releases seats and tells the volunteers", async () => {
  const db = await fresh();

  await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId: ids.shiftOpen },
  });

  const [revisionRow] = await query(
    db,
    "select revision from public.organization_revisions where organization_id = $1",
    [ids.orgA],
  );

  const cancelled = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "UPDATE_SHIFT",
    baseRevision: Number(revisionRow.revision),
    payload: { id: ids.shiftOpen, status: "canceled" },
  });
  assert.equal(cancelled.status, "applied");

  const [registration] = await query(
    db,
    "select status from public.registrations where shift_id = $1 and volunteer_id = $2",
    [ids.shiftOpen, ids.volunteerA],
  );
  assert.equal(registration.status, "canceled");

  const [notification] = await query(
    db,
    "select kind from public.notifications where volunteer_id = $1 order by created_at desc limit 1",
    [ids.volunteerA],
  );
  assert.equal(notification.kind, "shift_canceled");

  await db.close();
});
