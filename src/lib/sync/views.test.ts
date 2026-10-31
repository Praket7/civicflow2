import { buildVolunteerView, formatShiftRange, shiftWindow, type Row } from "./views";

const NOW = "2026-10-30T16:00:00.000Z";

function baseRows(): Parameters<typeof buildVolunteerView>[0]["rows"] {
  return {
    volunteers: [
      {
        id: "vol-1",
        name: "Maya Chen",
        first_name: "Maya",
        initials: "MC",
        email: "maya@example.org",
        phone: "",
        status: "active",
        joined_at: "2025-02-01T00:00:00.000Z",
        skills: ["Spanish"],
        causes: ["food"],
        availability: ["sat:morning"],
        interests: "",
        row_version: 4,
      } satisfies Row,
    ],
    opportunities: [
      {
        id: "opp-1",
        title: "Saturday food bank",
        cause: "food",
        organization_name: "Rivergate Kitchen",
        address: "100 Main St",
        description: "Pack boxes.",
        impact_metric: "120 meals packed",
        requirements: ["Closed-toe shoes"],
        image: "",
        image_alt: "",
      },
    ],
    shifts: [
      {
        id: "shift-1",
        opportunity_id: "opp-1",
        starts_at: "2026-10-31T13:00:00.000Z",
        ends_at: "2026-10-31T17:00:00.000Z",
        capacity: 2,
        confirmed: 2,
        waitlisted: 1,
        status: "scheduled",
      },
      {
        id: "shift-2",
        opportunity_id: "opp-1",
        starts_at: "2026-10-20T13:00:00.000Z",
        ends_at: "2026-10-20T16:00:00.000Z",
        capacity: 3,
        confirmed: 1,
        waitlisted: 0,
        status: "completed",
      },
    ],
    roles: [
      { shift_id: "shift-1", name: "Packer", required: 1, filled: 1 },
      { shift_id: "shift-1", name: "Sorter", required: 1, filled: 1 },
    ],
    registrations: [
      {
        id: "reg-2",
        shift_id: "shift-2",
        volunteer_id: "vol-1",
        status: "completed",
        role: "Packer",
      },
    ],
    waitlist: [],
    attendance: [
      {
        shift_id: "shift-2",
        volunteer_id: "vol-1",
        status: "completed",
        checked_in_at: NOW,
        checked_out_at: NOW,
      },
    ],
    hours: [
      {
        id: "hour-1",
        volunteer_id: "vol-1",
        opportunity_id: "opp-1",
        date: "2026-10-20",
        minutes: 180,
        approved_minutes: 120,
        status: "verified",
      },
      {
        id: "hour-2",
        volunteer_id: "vol-1",
        opportunity_id: "opp-1",
        date: "2026-10-28",
        minutes: 60,
        status: "pending",
      },
      {
        id: "hour-3",
        volunteer_id: "vol-other",
        opportunity_id: "opp-1",
        date: "2026-10-28",
        minutes: 999,
        status: "verified",
      },
    ],
    credentials: [
      {
        id: "cred-1",
        volunteer_id: "vol-1",
        credential_type_id: "type-1",
        identifier: "A-1",
        valid_through: "2026-11-10",
      },
    ],
    credentialTypes: [{ id: "type-1", name: "Food safety" }],
    notifications: [
      {
        id: "note-1",
        audience: "volunteer",
        volunteer_id: "vol-1",
        title: "Seat confirmed",
        body: "You're in.",
        kind: "WAITLIST_PROMOTED",
        priority: "high",
        created_at: "2026-10-30T15:00:00.000Z",
      },
      {
        id: "note-2",
        audience: "volunteer",
        volunteer_id: "vol-other",
        title: "Someone else",
        body: "",
        kind: "shift",
        priority: "normal",
        created_at: "2026-10-30T14:00:00.000Z",
      },
      {
        id: "note-3",
        audience: "all",
        volunteer_id: null,
        title: "All volunteers",
        body: "",
        kind: "shift",
        priority: "normal",
        created_at: "2026-10-30T13:00:00.000Z",
      },
    ],
    saved: [{ volunteer_id: "vol-1", opportunity_id: "opp-1" }],
  };
}

describe("volunteer view", () => {
  it("renders the server's seat count instead of inferring one", () => {
    const view = buildVolunteerView({ now: NOW, volunteerId: "vol-1", rows: baseRows() });
    const shift = view.shifts.find((entry) => entry.id === "shift-1");
    expect(shift?.seatsLeft).toBe(0);
    expect(shift?.confirmed).toBe(2);
    expect(shift?.capacity).toBe(2);
    expect(shift?.canRegister).toBe(true);
    expect(shift?.roles).toHaveLength(2);
  });

  it("separates upcoming from past without losing a completed registration", () => {
    const view = buildVolunteerView({ now: NOW, volunteerId: "vol-1", rows: baseRows() });
    expect(view.upcoming.map((shift) => shift.id)).toEqual(["shift-1"]);
    expect(view.past.map((shift) => shift.id)).toEqual(["shift-2"]);
    expect(view.past[0]?.registration?.status).toBe("completed");
    expect(view.past[0]?.attendance?.status).toBe("completed");
  });

  it("counts only this volunteer's approved and pending minutes", () => {
    const view = buildVolunteerView({ now: NOW, volunteerId: "vol-1", rows: baseRows() });
    expect(view.approvedMinutes).toBe(120);
    expect(view.pendingMinutes).toBe(60);
    expect(view.hours).toHaveLength(2);
  });

  it("shows only notifications addressed to this volunteer or everyone", () => {
    const view = buildVolunteerView({ now: NOW, volunteerId: "vol-1", rows: baseRows() });
    expect(view.notifications.map((entry) => entry.id)).toEqual(["note-1", "note-3"]);
  });

  it("marks a credential that expires inside a month", () => {
    const view = buildVolunteerView({ now: NOW, volunteerId: "vol-1", rows: baseRows() });
    expect(view.credentials[0]).toMatchObject({ name: "Food safety", status: "expiring" });
  });

  it("marks a queued shift while its command is still on the device", () => {
    const view = buildVolunteerView({
      now: NOW,
      volunteerId: "vol-1",
      rows: baseRows(),
      pendingShiftIds: ["shift-1"],
    });
    expect(view.shifts.find((entry) => entry.id === "shift-1")?.pending).toBe(true);
  });

  it("opens check-in only inside the server's window", () => {
    const startsAt = "2026-10-31T13:00:00.000Z";
    const endsAt = "2026-10-31T17:00:00.000Z";
    const before = shiftWindow("2026-10-31T11:00:00.000Z", startsAt, endsAt);
    const opening = shiftWindow("2026-10-31T12:30:00.000Z", startsAt, endsAt);
    const open = shiftWindow("2026-10-31T13:00:00.000Z", startsAt, endsAt);
    const closing = shiftWindow("2026-10-31T13:15:00.000Z", startsAt, endsAt);
    const after = shiftWindow("2026-10-31T13:16:00.000Z", startsAt, endsAt);
    expect(before.canCheckIn).toBe(false);
    expect(opening.canCheckIn).toBe(true);
    expect(open.canCheckIn).toBe(true);
    expect(closing.canCheckIn).toBe(true);
    expect(after.canCheckIn).toBe(false);
    // Checking out is still possible until the shift ends.
    expect(after.canCheckOut).toBe(true);
  });

  it("formats a shift in the organization's timezone", () => {
    const range = formatShiftRange(
      "2026-10-31T13:00:00.000Z",
      "2026-10-31T17:00:00.000Z",
      "America/New_York",
    );
    expect(range.day).toContain("Saturday");
    expect(range.time).toContain("9:00");
    expect(range.duration).toBe("4h");
  });
});
