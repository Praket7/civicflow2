import { describe, expect, it } from "vitest";
import { reportDataFrom } from "./sharedReportSource";

describe("report source", () => {
  it("maps the server's singular entity names onto the report shape", () => {
    const data = reportDataFrom({
      opportunity: [{ id: "p1", title: "Pantry" }],
      shift: [{ id: "s1", opportunity_id: "p1" }],
      volunteer: [{ id: "v1", name: "Alice Able" }],
      registration: [{ id: "r1", shift_id: "s1" }],
      attendance: [{ id: "a1", shift_id: "s1" }],
      hour_entry: [{ id: "h1", minutes: 60 }],
      credential: [{ id: "c1" }],
      credential_type: [{ id: "t1", name: "Food handler" }],
    });

    expect(data.opportunities[0].title).toBe("Pantry");
    expect(data.hourEntries[0].minutes).toBe(60);
    expect(data.credentialTypes[0].name).toBe("Food handler");
    expect(data.volunteers[0].name).toBe("Alice Able");
  });

  it("uses empty arrays for any entity the server omits", () => {
    const data = reportDataFrom({});

    expect(data.shifts).toEqual([]);
    expect(data.attendance).toEqual([]);
    expect(data.credentials).toEqual([]);
  });
});
