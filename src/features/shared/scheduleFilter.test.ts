import { describe, expect, it } from "vitest";
import { filterOpportunities, filterShifts, OPPORTUNITY_PAGE, SHIFT_PAGE } from "./scheduleFilter";

const opportunities = [
  {
    id: "opp-1",
    title: "Community Food Distribution",
    cause: "Food security",
    address: "214 Rivergate Ave",
  },
  { id: "opp-2", title: "Library Tutoring", cause: "Education", address: "1 Lafayette Square" },
];

const shifts = [
  {
    id: "shift-1",
    opportunity_id: "opp-1",
    starts_at: "2026-11-02T14:00:00Z",
    status: "scheduled",
  },
  { id: "shift-2", opportunity_id: "opp-2", starts_at: "2026-11-03T22:00:00Z", status: "canceled" },
];

const titleFor = (id: string) => opportunities.find((row) => row.id === id)?.title ?? "";
const when = (value: unknown) => (value === "2026-11-02T14:00:00Z" ? "Mon, Nov 2" : "Tue, Nov 3");

describe("shared schedule filters", () => {
  it("returns every row for an empty query", () => {
    expect(filterOpportunities(opportunities, "   ")).toHaveLength(2);
    expect(filterShifts(shifts, "", titleFor, when)).toHaveLength(2);
  });

  it("matches a program by title, cause, or address", () => {
    expect(filterOpportunities(opportunities, "tutor").map((row) => row.id)).toEqual(["opp-2"]);
    expect(filterOpportunities(opportunities, "food security").map((row) => row.id)).toEqual([
      "opp-1",
    ]);
    expect(filterOpportunities(opportunities, "lafayette").map((row) => row.id)).toEqual(["opp-2"]);
  });

  it("matches a shift by program, status, or displayed date", () => {
    expect(filterShifts(shifts, "library", titleFor, when).map((row) => row.id)).toEqual([
      "shift-2",
    ]);
    expect(filterShifts(shifts, "canceled", titleFor, when).map((row) => row.id)).toEqual([
      "shift-2",
    ]);
    expect(filterShifts(shifts, "mon, nov 2", titleFor, when).map((row) => row.id)).toEqual([
      "shift-1",
    ]);
  });

  it("keeps the first screen bounded", () => {
    expect(OPPORTUNITY_PAGE).toBeLessThanOrEqual(25);
    expect(SHIFT_PAGE).toBeLessThanOrEqual(100);
  });
});
