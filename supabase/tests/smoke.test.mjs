import assert from "node:assert/strict";
import test from "node:test";

import { createDatabase, ids, query, seed } from "./harness.mjs";

test("every migration applies and the fixture seeds", async () => {
  const db = await createDatabase();
  await seed(db);

  const [volunteers] = await query(db, "select count(*)::int as n from public.volunteers");
  assert.equal(volunteers.n, 3);

  const [roles] = await query(db, "select count(*)::int as n from public.shift_roles");
  assert.equal(roles.n, 2);

  const [memberships] = await query(
    db,
    "select count(*)::int as n from public.organization_memberships where organization_id = $1",
    [ids.orgA],
  );
  assert.equal(memberships.n, 4);

  await db.close();
});
