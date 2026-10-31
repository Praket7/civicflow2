import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(here, "..", "migrations");

export { randomUUID };

/** Applies the prelude and every migration, in filename order. */
export async function createDatabase() {
  const db = new PGlite();
  await db.exec(await readFile(join(here, "prelude.sql"), "utf8"));

  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    try {
      await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
    }
  }

  return db;
}

/** Runs work as the table owner, bypassing RLS. Used only to seed fixtures. */
export async function asOwner(db, work) {
  await db.exec("begin");
  try {
    const result = await work(db);
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

/**
 * Runs work as an authenticated user with the same claim PostgREST sets.
 * Rolled back by default so a failing assertion cannot leak into another test.
 */
export async function asUser(db, userId, work, { commit = false } = {}) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await db.exec("set local role authenticated");
    const result = await work(db);
    await db.exec(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

/** Runs work with no identity, the way an anonymous request arrives. */
export async function asAnon(db, work) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', '', true)");
    await db.exec("set local role anon");
    const result = await work(db);
    await db.exec("rollback");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

export async function query(db, text, params = []) {
  const result = await db.query(text, params);
  return result.rows;
}

/** Calls the public command entry point and returns its protocol response. */
export async function sendCommand(
  db,
  userId,
  {
    organizationId,
    command,
    payload = {},
    versions = {},
    baseRevision = null,
    operationId = randomUUID(),
    replicaId = "00000000-0000-4000-8000-000000000001",
  },
) {
  return asUser(
    db,
    userId,
    async () => {
      const rows = await query(
        db,
        `select public.apply_command(
            $1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint,
            $6::jsonb, $7::jsonb
         ) as result`,
        [
          operationId,
          organizationId,
          replicaId,
          command,
          baseRevision,
          JSON.stringify(versions),
          JSON.stringify(payload),
        ],
      );
      return rows[0].result;
    },
    { commit: true },
  );
}

/** Calls the pull RPC as a user. */
export async function pull(db, userId, organizationId, after = 0, limit = 500) {
  return asUser(db, userId, async () => {
    const rows = await query(
      db,
      "select public.pull_changes($1::uuid, $2::bigint, $3::integer) as result",
      [organizationId, after, limit],
    );
    return rows[0].result;
  });
}

/** The ids every suite shares. Fixed so a failure points at a known row. */
export const ids = {
  orgA: "11111111-1111-4111-8111-111111111111",
  orgB: "22222222-2222-4222-8222-222222222222",
  ownerA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  coordinatorA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  volunteerUserA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  volunteerUserA2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  ownerB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  volunteerA: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  volunteerA2: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
  volunteerB: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
  opportunityA: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  opportunityB: "dddddddd-dddd-4ddd-8ddd-ddddddddddd9",
  shiftSingle: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
  shiftOpen: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
  shiftPast: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
  shiftSoon: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
  shiftB: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9",
  credentialTypeA: "ffffffff-ffff-4fff-8fff-fffffffffff1",
  replicaA: "00000000-0000-4000-8000-0000000000a1",
  replicaA2: "00000000-0000-4000-8000-0000000000a2",
  replicaB: "00000000-0000-4000-8000-0000000000b1",
};

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/**
 * Seeds two organizations that never share a row. The second exists so every
 * isolation suite has something real to fail against.
 */
export async function seed(db) {
  await asOwner(db, async () => {
    for (const [id, email, name] of [
      [ids.ownerA, "owner-a@example.org", "Olivia Owner"],
      [ids.coordinatorA, "coord-a@example.org", "Casey Coordinator"],
      [ids.volunteerUserA, "vol-a@example.org", "Vera Volunteer"],
      [ids.volunteerUserA2, "vol-a2@example.org", "Vince Volunteer"],
      [ids.ownerB, "owner-b@example.org", "Owen Other"],
    ]) {
      await query(
        db,
        "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
        [id, email, JSON.stringify({ name })],
      );
    }

    await query(
      db,
      `insert into public.organizations (id, name, initials, mission, city, state, timezone)
       values
         ($1, 'Rivergate Kitchen', 'RK', 'Food for every neighbor', 'Buffalo', 'NY', 'America/New_York'),
         ($2, 'Harbor Lights', 'HL', 'Light for the harbor', 'Erie', 'PA', 'America/New_York')`,
      [ids.orgA, ids.orgB],
    );

    await query(
      db,
      "insert into public.volunteers (id, organization_id, name, first_name, initials, email, phone, joined_at, status, tone, availability)\n" +
        "values\n" +
        "  ($1, $2, 'Vera Volunteer', 'Vera', 'VV', 'vol-a@example.org', '555-0101', now() - interval '90 days', 'active', 'sage', '[]'::jsonb),\n" +
        "  ($3, $2, 'Vince Volunteer', 'Vince', 'VV', 'vol-a2@example.org', '555-0102', now() - interval '30 days', 'active', 'sky', '[]'::jsonb),\n" +
        "  ($4, $5, 'Bianca Other', 'Bianca', 'BO', 'vol-b@example.org', '555-0201', now() - interval '10 days', 'active', 'clay', '[]'::jsonb)",
      [ids.volunteerA, ids.orgA, ids.volunteerA2, ids.volunteerB, ids.orgB],
    );

    await query(
      db,
      `insert into public.organization_memberships
         (organization_id, user_id, role, status, joined_at, volunteer_id)
       values
         ($1, $2, 'owner', 'active', now(), null),
         ($1, $3, 'coordinator', 'active', now(), null),
         ($1, $4, 'volunteer', 'active', now(), $6),
         ($1, $5, 'volunteer', 'active', now(), $7),
         ($8, $9, 'owner', 'active', now(), null)`,
      [
        ids.orgA,
        ids.ownerA,
        ids.coordinatorA,
        ids.volunteerUserA,
        ids.volunteerUserA2,
        ids.volunteerA,
        ids.volunteerA2,
        ids.orgB,
        ids.ownerB,
      ],
    );

    await query(
      db,
      `insert into public.credential_types (id, organization_id, name, validity_months)
       values ($1, $2, 'Food handler', 24)`,
      [ids.credentialTypeA, ids.orgA],
    );

    await query(
      db,
      `insert into public.opportunities
         (id, organization_id, slug, title, cause, organization_name, description, address)
       values
         ($1, $2, 'saturday-pantry', 'Saturday Pantry', 'Hunger', 'Rivergate Kitchen', 'Sort and pack', '1 Main St'),
         ($3, $4, 'harbor-cleanup', 'Harbor Cleanup', 'Environment', 'Harbor Lights', 'Pick up', '2 Dock St')`,
      [ids.opportunityA, ids.orgA, ids.opportunityB, ids.orgB],
    );

    await query(
      db,
      `insert into public.shifts
         (id, organization_id, opportunity_id, starts_at, ends_at, capacity, status)
       values
         ($1, $2, $3, $5::timestamptz, $6::timestamptz, 1, 'scheduled'),
         ($4, $2, $3, $7::timestamptz, $8::timestamptz, 5, 'scheduled'),
         ($9, $2, $3, $10::timestamptz, $11::timestamptz, 3, 'scheduled'),
         ($12, $13, $14, $5::timestamptz, $6::timestamptz, 2, 'scheduled')`,
      [
        ids.shiftSingle,
        ids.orgA,
        ids.opportunityA,
        ids.shiftOpen,
        hoursFromNow(24),
        hoursFromNow(27),
        hoursFromNow(48),
        hoursFromNow(51),
        ids.shiftPast,
        hoursFromNow(-48),
        hoursFromNow(-45),
        ids.shiftB,
        ids.orgB,
        ids.opportunityB,
      ],
    );

    await query(
      db,
      `insert into public.shifts
         (id, organization_id, opportunity_id, starts_at, ends_at, capacity, status)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 4, 'scheduled')`,
      [ids.shiftSoon, ids.orgA, ids.opportunityA, hoursFromNow(0.5), hoursFromNow(3.5)],
    );

    await query(
      db,
      `insert into public.shift_roles (organization_id, shift_id, name, required)
       values
         ($1, $2, 'Packer', 2),
         ($1, $3, 'Greeter', 2)`,
      [ids.orgA, ids.shiftOpen, ids.shiftOpen],
    );
  });
}

/** Creates an active check-in code using the test clock. */
export async function issueCheckinCode(db, shiftId, { code = "123456", token = "tok-123" } = {}) {
  return asOwner(db, async () => {
    const rows = await query(
      db,
      `insert into public.checkin_codes
         (organization_id, shift_id, code, token, expires_at, created_by)
       values ($1, $2, $3, $4, now() + interval '10 minutes', $5)
       returning id`,
      [ids.orgA, shiftId, code, token, ids.coordinatorA],
    );
    return rows[0].id;
  });
}
