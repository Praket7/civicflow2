import { describe, expect, it } from "vitest";
import { planShift, planUpcoming } from "./sharedPlan";
import type { SharedReplicaData } from "./sharedReplica";
import type { SharedRow } from "./sharedRows";

const SHIFT_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const SHIFT_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const SHIFT_C = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const V1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const V2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const V3 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const V4 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";

function row(id: string, values: Record<string, unknown> = {}): SharedRow {
  return { id, ...values };
}

function base(overrides: Partial<SharedReplicaData> = {}): SharedReplicaData {
  return {
    organization: null,
    opportunities: [],
    shifts: [
      row(SHIFT_A, {
        starts_at: "2030-06-01T13:00:00.000Z",
        ends_at: "2030-06-01T16:00:00.000Z",
        capacity: 4,
        status: "scheduled",
      }),
      row(SHIFT_B, {
        starts_at: "2030-06-01T14:00:00.000Z",
        ends_at: "2030-06-01T17:00:00.000Z",
        capacity: 4,
        status: "scheduled",
      }),
    ],
    shiftRoles: [
      row("role-a1", { shift_id: SHIFT_A, name: "Greeter", required: 2, filled: 0 }),
      row("role-b1", { shift_id: SHIFT_B, name: "Stocker", required: 1, filled: 0 }),
    ],
    roleRequirements: [
      row("req-a1", { shift_id: SHIFT_A, role_name: "Greeter", skill: "Welcoming" }),
    ],
    volunteers: [
      row(V1, { name: "Vera", status: "active" }),
      row(V2, { name: "Vince", status: "active" }),
      row(V3, { name: "Val", status: "active" }),
      row(V4, { name: "Inactive", status: "inactive" }),
    ],
    volunteerSkills: [
      row("skill-1", { volunteer_id: V3, skill: "welcoming" }),
      row("skill-2", { volunteer_id: V2, skill: "stocker" }),
    ],
    availabilityRules: [],
    credentialTypes: [],
    credentials: [],
    registrations: [],
    waitlists: [],
    attendance: [],
    hourEntries: [],
    series: [],
    seriesRoles: [],
    ...overrides,
  };
}

describe("shared recovery plan", () => {
  it("fills only the open role seats and never assigns an inactive volunteer", () => {
    const data = base({
      waitlists: [
        row("wait-1", { shift_id: SHIFT_A, volunteer_id: V2, position: 1, status: "waiting" }),
      ],
    });
    const assignments = planShift(data, SHIFT_A);

    expect(assignments).toHaveLength(2);
    expect(assignments[0]).toEqual({ shiftId: SHIFT_A, volunteerId: V2, role: "Greeter" });
    expect(assignments.some((assignment) => assignment.volunteerId === V4)).toBe(false);
  });

  it("subtracts live registrations from each role and the shift capacity", () => {
    const data = base({
      registrations: [
        row("reg-1", { shift_id: SHIFT_A, volunteer_id: V1, status: "confirmed", role: "Greeter" }),
        row("reg-2", {
          shift_id: SHIFT_A,
          volunteer_id: V2,
          status: "registered",
          role: "Greeter",
        }),
      ],
    });
    expect(planShift(data, SHIFT_A)).toEqual([]);
  });

  it("does not put a volunteer in two overlapping shifts", () => {
    const data = base({
      volunteers: [
        row(V1, { name: "Vera", status: "active" }),
        row(V2, { name: "Vince", status: "active" }),
      ],
      shiftRoles: [
        row("role-a1", { shift_id: SHIFT_A, name: "Greeter", required: 1, filled: 0 }),
        row("role-b1", { shift_id: SHIFT_B, name: "Stocker", required: 1, filled: 0 }),
      ],
    });
    const plan = planUpcoming(data, { now: new Date("2030-05-01T00:00:00.000Z") });

    expect(plan.assignments).toHaveLength(2);
    expect(new Set(plan.assignments.map((assignment) => assignment.volunteerId)).size).toBe(2);
  });

  it("reuses one volunteer for shifts that do not overlap", () => {
    const data = base({
      shifts: [
        row(SHIFT_A, {
          starts_at: "2030-06-01T13:00:00.000Z",
          ends_at: "2030-06-01T16:00:00.000Z",
          capacity: 2,
          status: "scheduled",
        }),
        row(SHIFT_C, {
          starts_at: "2030-06-08T13:00:00.000Z",
          ends_at: "2030-06-08T16:00:00.000Z",
          capacity: 2,
          status: "scheduled",
        }),
      ],
      shiftRoles: [
        row("role-a1", { shift_id: SHIFT_A, name: "Greeter", required: 1, filled: 0 }),
        row("role-c1", { shift_id: SHIFT_C, name: "Greeter", required: 1, filled: 0 }),
      ],
      volunteers: [row(V1, { name: "Vera", status: "active" })],
    });
    const plan = planUpcoming(data, { now: new Date("2030-05-01T00:00:00.000Z") });

    expect(plan.assignments.map((assignment) => assignment.volunteerId)).toEqual([V1, V1]);
  });

  it("ignores canceled shifts and shifts that start inside the lead window", () => {
    const now = new Date("2030-06-01T12:50:00.000Z");
    const data = base({
      shifts: [
        row(SHIFT_A, {
          starts_at: "2030-06-01T13:00:00.000Z",
          ends_at: "2030-06-01T16:00:00.000Z",
          capacity: 2,
          status: "scheduled",
        }),
        row(SHIFT_B, {
          starts_at: "2030-06-02T13:00:00.000Z",
          ends_at: "2030-06-02T16:00:00.000Z",
          capacity: 2,
          status: "canceled",
        }),
      ],
    });
    const plan = planUpcoming(data, { now });
    expect(plan.assignments).toEqual([]);
    expect(plan.shifts).toBe(0);
  });
});
