import assert from "node:assert/strict";
import test from "node:test";

import {
  asOwner,
  createDatabase,
  ids,
  pull,
  query,
  randomUUID,
  seed,
  sendCommand,
} from "./harness.mjs";

async function fresh() {
  const db = await createDatabase();
  await seed(db);
  return db;
}

function seriesPayload(overrides = {}) {
  const id = randomUUID();
  return {
    id,
    opportunityId: ids.opportunityA,
    timezone: "America/New_York",
    capacity: 6,
    recurrence: {
      kind: "weekly",
      intervalWeeks: 1,
      weekdays: [0],
      startsLocalTime: "09:00",
      durationMinutes: 120,
      startsOn: "2026-11-01",
      occurrenceCount: 3,
    },
    roles: [
      { name: "Greeter", required: 2 },
      { name: "Stocker", required: 3 },
    ],
    occurrences: [
      {
        date: "2026-11-01",
        startsAt: "2026-11-01T14:00:00.000Z",
        endsAt: "2026-11-01T16:00:00.000Z",
      },
      {
        date: "2026-11-08",
        startsAt: "2026-11-08T14:00:00.000Z",
        endsAt: "2026-11-08T16:00:00.000Z",
      },
      {
        date: "2026-11-15",
        startsAt: "2026-11-15T14:00:00.000Z",
        endsAt: "2026-11-15T16:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

test("a coordinator publishes a weekly series and every occurrence in one command", async () => {
  const db = await fresh();
  const payload = seriesPayload();

  const result = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_SHIFT_SERIES",
    payload,
  });

  assert.equal(result.status, "applied", JSON.stringify(result));
  assert.equal(result.data.occurrences, 3);
  assert.equal(result.data.shiftIds.length, 3);
  assert.ok(result.changes.some((change) => change.entity === "shift_series"));

  const [series] = await query(
    db,
    "select opportunity_id, recurrence_kind, interval_weeks, occurrence_count from public.shift_series where id = $1",
    [payload.id],
  );
  assert.equal(series.opportunity_id, ids.opportunityA);
  assert.equal(series.recurrence_kind, "weekly");
  assert.equal(series.interval_weeks, 1);
  assert.equal(series.occurrence_count, 3);

  const shifts = await query(
    db,
    "select starts_at, series_id, occurrence_date from public.shifts where series_id = $1 order by starts_at",
    [payload.id],
  );
  assert.equal(shifts.length, 3);
  assert.equal(shifts[0].occurrence_date.toISOString().slice(0, 10), "2026-11-01");
  assert.equal(shifts[2].occurrence_date.toISOString().slice(0, 10), "2026-11-15");

  const roles = await query(
    db,
    "select name, required from public.shift_roles where shift_id = $1 order by name",
    [result.data.shiftIds[0]],
  );
  assert.deepEqual(
    roles.map((role) => [role.name, role.required]),
    [
      ["Greeter", 2],
      ["Stocker", 3],
    ],
  );

  const pulled = await asOwner(db, async () => {
    const rows = await query(
      db,
      "select entity_type, count(*)::int as n from sync.sync_changes where entity_type in ('shift_series', 'shift_series_role', 'shift') group by entity_type",
    );
    return rows;
  });
  assert.equal(pulled.find((row) => row.entity_type === "shift_series").n, 1);
  assert.equal(pulled.find((row) => row.entity_type === "shift_series_role").n, 2);

  const page = await pull(db, ids.coordinatorA, ids.orgA);
  const published = page.changes.find(
    (change) => change.entity === "shift_series" && change.id === payload.id,
  );
  assert.ok(published, "the series is in the next pull");
  assert.equal(published.payload.occurrence_count, 3);
  assert.equal(
    page.changes.filter(
      (change) => change.entity === "shift" && change.payload?.series_id === payload.id,
    ).length,
    3,
  );

  await db.close();
});

test("a volunteer cannot publish a series", async () => {
  const db = await fresh();
  const payload = seriesPayload();

  const result = await sendCommand(db, ids.volunteerUserA, {
    organizationId: ids.orgA,
    command: "CREATE_SHIFT_SERIES",
    payload,
  });

  assert.equal(result.status, "forbidden");
  const [count] = await query(
    db,
    "select count(*)::int as n from public.shift_series where id = $1",
    [payload.id],
  );
  assert.equal(count.n, 0);

  await db.close();
});

test("one malformed occurrence refuses the whole series", async () => {
  const db = await fresh();
  const payload = seriesPayload();
  payload.occurrences[1].endsAt = payload.occurrences[1].startsAt;

  const result = await sendCommand(db, ids.coordinatorA, {
    organizationId: ids.orgA,
    command: "CREATE_SHIFT_SERIES",
    payload,
  });

  assert.equal(result.status, "validation_error");
  assert.equal(result.code, "invalid_series");

  const [series] = await query(
    db,
    "select count(*)::int as n from public.shift_series where id = $1",
    [payload.id],
  );
  assert.equal(series.n, 0);
  const [shifts] = await query(
    db,
    "select count(*)::int as n from public.shifts where series_id = $1",
    [payload.id],
  );
  assert.equal(shifts.n, 0);

  await db.close();
});

test("a repeat outside the accepted limits is refused before writing", async () => {
  const db = await fresh();

  const ambiguousEnd = {
    recurrence: { ...seriesPayload().recurrence, occurrenceCount: null, endsOn: null },
  };
  for (const patch of [
    ambiguousEnd,
    { occurrences: [] },
    { occurrences: Array.from({ length: 61 }, () => seriesPayload().occurrences[0]) },
  ]) {
    const result = await sendCommand(db, ids.coordinatorA, {
      organizationId: ids.orgA,
      command: "CREATE_SHIFT_SERIES",
      payload: seriesPayload(patch),
    });
    assert.equal(result.status, "validation_error", JSON.stringify(patch));
    assert.equal(result.code, "invalid_series");
  }

  const [series] = await query(db, "select count(*)::int as n from public.shift_series");
  assert.equal(series.n, 0);

  await db.close();
});
