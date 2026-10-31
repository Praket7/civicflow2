import assert from "node:assert/strict";
import test from "node:test";

import { asOwner, asUser, createDatabase, ids, query, seed, sendCommand } from "./harness.mjs";

async function dispatch(db, limit = 50) {
  return asOwner(db, async () => {
    const rows = await query(db, "select public.dispatch_reminders($1::integer) as result", [
      limit,
    ]);
    return rows[0].result;
  });
}

async function register(db, userId, volunteerId, shiftId) {
  return sendCommand(db, userId, {
    organizationId: ids.orgA,
    command: "REGISTER_FOR_SHIFT",
    payload: { shiftId, volunteerId, allowWaitlist: true },
  });
}

async function count(db, sql, params = []) {
  const rows = await query(db, sql, params);
  return rows[0].n;
}

test("a due reminder is created once, with an in-app delivery already sent", async () => {
  const db = await createDatabase();
  await seed(db);

  const rules = await count(
    db,
    "select count(*)::int as n from public.notification_rules where organization_id = $1",
    [ids.orgA],
  );
  assert.equal(rules, 5, "every organization gets the five default rules");

  const registered = await register(db, ids.volunteerUserA, ids.volunteerA, ids.shiftSingle);
  assert.equal(registered.status, "applied");

  const first = await dispatch(db);
  assert.equal(first.status, "ok");
  assert.equal(first.generated, 1, "only the 24-hour reminder is due");
  assert.equal(first.claimed, 0, "in-app needs no external dispatcher");

  const [notification] = await query(
    db,
    "select id, title, audience, dedupe_key from public.notifications where organization_id = $1",
    [ids.orgA],
  );
  assert.equal(notification.audience, "volunteer");
  assert.match(notification.dedupe_key, /^shift_reminder:/);

  const deliveries = await query(
    db,
    "select channel, status from public.notification_deliveries where notification_id = $1",
    [notification.id],
  );
  assert.deepEqual(deliveries, [{ channel: "in_app", status: "sent" }]);

  const second = await dispatch(db);
  assert.equal(second.generated, 0, "the dedupe key absorbs a second pass");
  const total = await count(db, "select count(*)::int as n from public.notifications");
  assert.equal(total, 1);

  await db.close();
});

test("quiet hours defer a push, and the delivery is not claimed early", async () => {
  const db = await createDatabase();
  await seed(db);

  await register(db, ids.volunteerUserA, ids.volunteerA, ids.shiftSingle);

  await asUser(
    db,
    ids.volunteerUserA,
    async () => {
      await query(
        db,
        `select public.register_push_subscription(
          $1::uuid, 'https://push.example.test/abc', 'p256dh-key', 'auth-key', 'Test phone')`,
        [ids.orgA],
      );
      await query(
        db,
        `select public.save_notification_preferences(
          $1::uuid, true, true, false, false,
          ((now() at time zone 'America/New_York')::time - interval '1 hour')::time,
          ((now() at time zone 'America/New_York')::time + interval '1 hour')::time,
          1440)`,
        [ids.orgA],
      );
    },
    { commit: true },
  );

  const result = await dispatch(db);
  assert.equal(result.generated, 1);
  assert.equal(result.claimed, 0, "a quiet-hours push must not be sent now");

  const [push] = await query(
    db,
    `select status, scheduled_at > now() as future
     from public.notification_deliveries
     where organization_id = $1 and channel = 'push'`,
    [ids.orgA],
  );
  assert.equal(push.status, "scheduled");
  assert.equal(push.future, true);

  await db.close();
});

test("a due push is claimed once and a lost response is retried, not duplicated", async () => {
  const db = await createDatabase();
  await seed(db);
  await register(db, ids.volunteerUserA, ids.volunteerA, ids.shiftSingle);

  await asUser(
    db,
    ids.volunteerUserA,
    async () => {
      await query(
        db,
        `select public.register_push_subscription(
          $1::uuid, 'https://push.example.test/abc', 'p256dh-key', 'auth-key', 'Test phone')`,
        [ids.orgA],
      );
      await query(
        db,
        `select public.save_notification_preferences(
          $1::uuid, true, true, false, false, null, null, 1440)`,
        [ids.orgA],
      );
    },
    { commit: true },
  );

  const first = await dispatch(db);
  assert.equal(first.claimed, 1);
  const job = first.jobs[0];
  assert.equal(job.channel, "push");
  assert.equal(job.push.length, 1);
  assert.equal(job.push[0].endpoint, "https://push.example.test/abc");

  const second = await dispatch(db);
  assert.equal(second.claimed, 0, "a sending row is not handed out twice");

  await asOwner(db, async () => {
    await query(db, "select public.complete_delivery($1::uuid, 'failed', 'timeout', 'test')", [
      job.deliveryId,
    ]);
  });

  const [row] = await query(
    db,
    "select status, attempts, last_error from public.notification_deliveries where id = $1",
    [job.deliveryId],
  );
  assert.equal(row.status, "scheduled");
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, "timeout");

  await db.close();
});

test("read state is scoped to the volunteer and logged for the next pull", async () => {
  const db = await createDatabase();
  await seed(db);
  await register(db, ids.volunteerUserA, ids.volunteerA, ids.shiftSingle);
  await dispatch(db);

  const [notification] = await query(
    db,
    "select id from public.notifications where organization_id = $1",
    [ids.orgA],
  );

  const read = await asUser(
    db,
    ids.volunteerUserA,
    async () => {
      const rows = await query(db, "select public.mark_notification_read($1::uuid) as result", [
        notification.id,
      ]);
      return rows[0].result;
    },
    { commit: true },
  );
  assert.equal(read.status, "ok");

  const [row] = await query(
    db,
    "select read_at, row_version from public.notifications where id = $1",
    [notification.id],
  );
  assert.notEqual(row.read_at, null);
  assert.equal(row.row_version, 2);

  const other = await asUser(db, ids.volunteerUserA2, async () => {
    const rows = await query(db, "select public.mark_notification_read($1::uuid) as result", [
      notification.id,
    ]);
    return rows[0].result;
  });
  assert.equal(other.status, "not_found", "another volunteer cannot mark it");

  await db.close();
});

test("missed shifts and expiring credentials reach staff exactly once", async () => {
  const db = await createDatabase();
  await seed(db);

  await asOwner(db, async () => {
    await query(
      db,
      `insert into public.shifts
         (id, organization_id, opportunity_id, starts_at, ends_at, capacity, status)
       values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8', $1::uuid, $2::uuid,
               now() - interval '90 minutes', now() - interval '30 minutes', 4, 'scheduled')`,
      [ids.orgA, ids.opportunityA],
    );
    await query(
      db,
      `insert into public.registrations
         (organization_id, shift_id, volunteer_id, status)
       values ($1::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8', $2::uuid, 'registered')`,
      [ids.orgA, ids.volunteerA2],
    );
    await query(
      db,
      `insert into public.volunteer_credentials
         (organization_id, volunteer_id, credential_type_id, valid_through)
       values ($1::uuid, $2::uuid, $3::uuid, current_date + 3)`,
      [ids.orgA, ids.volunteerA, ids.credentialTypeA],
    );
  });

  const result = await dispatch(db);
  // One missed-shift follow-up for staff, one credential notice each for staff
  // and the volunteer. The shift also has no reminder rules due for it.
  assert.equal(result.generated, 3);

  const titles = await query(
    db,
    "select kind, audience, title from public.notifications where organization_id = $1 order by kind, audience",
    [ids.orgA],
  );
  assert.equal(titles.filter((row) => row.kind === "follow_up").length, 1);
  assert.equal(titles.filter((row) => row.kind === "credential").length, 2);

  const second = await dispatch(db);
  assert.equal(second.generated, 0);
  assert.equal(await count(db, "select count(*)::int as n from public.notifications"), 3);

  await db.close();
});

test("only the service role can dispatch or claim a delivery", async () => {
  const db = await createDatabase();
  await seed(db);

  await assert.rejects(
    asUser(db, ids.ownerA, async () => {
      await query(db, "select public.dispatch_reminders(10)");
    }),
    /service_role_required/,
  );

  await assert.rejects(
    asUser(db, ids.ownerA, async () => {
      await query(db, "select public.complete_delivery($1::uuid, 'sent')", [
        "00000000-0000-4000-8000-000000000000",
      ]);
    }),
    /service_role_required/,
  );

  await db.close();
});

test("a volunteer's lead time overrides the organization's rule", async () => {
  const db = await createDatabase();
  await seed(db);
  await register(db, ids.volunteerUserA, ids.volunteerA, ids.shiftOpen);

  await asUser(
    db,
    ids.volunteerUserA,
    async () => {
      await query(
        db,
        "select public.save_notification_preferences($1::uuid, true, false, false, false, null, null, 2880)",
        [ids.orgA],
      );
    },
    { commit: true },
  );

  const early = await dispatch(db);
  assert.equal(early.generated, 1, "a two-day lead time fires two days out");

  await asOwner(db, async () => {
    await query(db, "delete from public.notifications where organization_id = $1", [ids.orgA]);
  });

  await asUser(
    db,
    ids.volunteerUserA,
    async () => {
      await query(
        db,
        "select public.save_notification_preferences($1::uuid, true, false, false, false, null, null, 60)",
        [ids.orgA],
      );
    },
    { commit: true },
  );

  const late = await dispatch(db);
  assert.equal(late.generated, 0, "a one-hour lead time waits");

  await db.close();
});
