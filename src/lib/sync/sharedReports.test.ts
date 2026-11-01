import { describe, expect, it } from "vitest";
import {
  buildSharedReport,
  defaultRange,
  monthKeys,
  presetRange,
  reportToCsv,
  type SharedReportData,
} from "./sharedReports";
import type { SharedRow } from "./sharedRows";

const NOW = new Date("2026-03-15T12:00:00Z");
const RANGE = { from: "2026-01-01", to: "2026-03-31" };

function row(id: string, value: Record<string, unknown>): SharedRow {
  return { id, ...value };
}

function data(): SharedReportData {
  return {
    opportunities: [
      row("p1", { title: 'Pantry, "East"', cause: "Hunger" }),
      row("p2", { title: "Tutoring", cause: "Education" }),
    ],
    shifts: [
      row("s1", {
        opportunity_id: "p1",
        starts_at: "2026-01-10T15:00:00Z",
        status: "completed",
      }),
      row("s2", {
        opportunity_id: "p1",
        starts_at: "2026-02-10T15:00:00Z",
        status: "scheduled",
      }),
      row("s3", {
        opportunity_id: "p2",
        starts_at: "2026-03-10T15:00:00Z",
        status: "completed",
      }),
      row("s4", {
        opportunity_id: "p2",
        starts_at: "2025-12-31T15:00:00Z",
        status: "completed",
      }),
    ],
    volunteers: [
      row("v1", { name: "Alice Able" }),
      row("v2", { name: "Bob Baker" }),
      row("v3", { name: "Cara Chen" }),
    ],
    registrations: [
      row("r1", { shift_id: "s1", volunteer_id: "v1", status: "completed" }),
      row("r2", { shift_id: "s2", volunteer_id: "v2", status: "confirmed" }),
      row("r3", { shift_id: "s3", volunteer_id: "v2", status: "canceled" }),
      row("r4", { shift_id: "s4", volunteer_id: "v1", status: "registered" }),
    ],
    attendance: [
      row("a1", { shift_id: "s1", volunteer_id: "v1", status: "completed" }),
      row("a2", { shift_id: "s1", volunteer_id: "v2", status: "no_show" }),
      row("a3", { shift_id: "s3", volunteer_id: "v2", status: "checked_in" }),
      row("a4", { shift_id: "s4", volunteer_id: "v1", status: "completed" }),
    ],
    hourEntries: [
      row("h1", {
        volunteer_id: "v1",
        opportunity_id: "p1",
        source_shift_id: "s1",
        date: "2026-01-10",
        minutes: 120,
        approved_minutes: 90,
        status: "verified",
      }),
      row("h2", {
        volunteer_id: "v1",
        opportunity_id: "p1",
        source_shift_id: "s1",
        date: "2026-01-11",
        minutes: 60,
        status: "pending",
      }),
      row("h3", {
        volunteer_id: "v2",
        opportunity_id: "p2",
        source_shift_id: "s3",
        date: "2026-03-10",
        minutes: 180,
        status: "verified",
      }),
      row("h4", {
        volunteer_id: "v2",
        opportunity_id: "p2",
        date: "2026-02-15",
        minutes: 30,
        status: "rejected",
      }),
      row("h5", {
        volunteer_id: "v3",
        opportunity_id: "p1",
        date: "2025-12-01",
        minutes: 60,
        status: "verified",
      }),
    ],
    credentials: [
      row("c1", {
        volunteer_id: "v1",
        credential_type_id: "t1",
        valid_through: "2026-01-01",
        verified_at: "2025-01-01T12:00:00Z",
      }),
      row("c2", {
        volunteer_id: "v2",
        credential_type_id: "t1",
        valid_through: "2026-04-01",
        verified_at: "2025-04-01T12:00:00Z",
      }),
      row("c3", {
        volunteer_id: "v3",
        credential_type_id: "t2",
        valid_through: "2026-03-20",
        verified_at: null,
      }),
      row("c4", {
        volunteer_id: "v1",
        credential_type_id: "t2",
        valid_through: "2026-12-01",
        verified_at: "2025-05-01T12:00:00Z",
      }),
    ],
    credentialTypes: [row("t1", { name: "Food handler" }), row("t2", { name: "Tutor" })],
  };
}

describe("shared impact report", () => {
  it("totals verified, pending and rejected hours inside the range", () => {
    const report = buildSharedReport(data(), RANGE, { now: NOW });

    expect(report.totals.verifiedMinutes).toBe(270);
    expect(report.totals.pendingMinutes).toBe(60);
    expect(report.totals.rejectedMinutes).toBe(30);
    expect(report.totals.volunteers).toBe(2);
    expect(report.totals.newVolunteers).toBe(2);
    expect(report.totals.shiftsCompleted).toBe(2);
    expect(report.totals.registrations).toBe(2);
    expect(report.totals.attended).toBe(2);
    expect(report.totals.noShows).toBe(1);
    expect(report.totals.attendanceRate).toBe(67);
    expect(report.hasData).toBe(true);
  });

  it("breaks hours down by program without counting another program's shifts", () => {
    const report = buildSharedReport(data(), RANGE, { now: NOW });

    expect(report.programs.map((program) => program.title)).toEqual(["Tutoring", 'Pantry, "East"']);
    const pantry = report.programs.find((program) => program.id === "p1");
    expect(pantry).toMatchObject({
      verifiedMinutes: 90,
      pendingMinutes: 60,
      volunteers: 1,
      shiftsCompleted: 1,
      attended: 1,
      cause: "Hunger",
    });
    const tutoring = report.programs.find((program) => program.id === "p2");
    expect(tutoring).toMatchObject({
      verifiedMinutes: 180,
      pendingMinutes: 0,
      volunteers: 1,
      shiftsCompleted: 1,
      attended: 1,
    });
  });

  it("fills every month in the range, including empty ones", () => {
    const report = buildSharedReport(data(), RANGE, { now: NOW });

    expect(report.months).toEqual([
      { key: "2026-01", verifiedMinutes: 90, pendingMinutes: 60 },
      { key: "2026-02", verifiedMinutes: 0, pendingMinutes: 0 },
      { key: "2026-03", verifiedMinutes: 180, pendingMinutes: 0 },
    ]);
  });

  it("ranks volunteers and keeps their last served date", () => {
    const report = buildSharedReport(data(), RANGE, { now: NOW });

    expect(report.volunteers).toHaveLength(2);
    expect(report.volunteers[0]).toMatchObject({
      id: "v2",
      name: "Bob Baker",
      verifiedMinutes: 180,
      pendingMinutes: 0,
      shifts: 1,
      lastServed: "2026-03-10",
    });
    expect(report.volunteers[1]).toMatchObject({
      id: "v1",
      name: "Alice Able",
      verifiedMinutes: 90,
      pendingMinutes: 60,
      shifts: 1,
      lastServed: "2026-01-10",
    });
    expect(report.volunteers.map((volunteer) => volunteer.name)).not.toContain("Cara Chen");
  });

  it("classifies credentials against the day the report is generated", () => {
    const report = buildSharedReport(data(), RANGE, { now: NOW });

    expect(report.credentials).toMatchObject({
      valid: 1,
      expiring: 1,
      expired: 1,
      unverified: 1,
    });
    expect(report.credentials.expiringSoon.map((credential) => credential.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(report.credentials.expiringSoon[0]).toMatchObject({
      typeName: "Food handler",
      volunteerName: "Alice Able",
      state: "expired",
    });
  });

  it("narrows every calculation to one program when asked", () => {
    const report = buildSharedReport(data(), RANGE, { now: NOW, opportunityId: "p1" });

    expect(report.totals.verifiedMinutes).toBe(90);
    expect(report.totals.pendingMinutes).toBe(60);
    expect(report.totals.shiftsCompleted).toBe(1);
    expect(report.totals.registrations).toBe(2);
    expect(report.totals.attended).toBe(1);
    expect(report.totals.noShows).toBe(1);
    expect(report.totals.newVolunteers).toBe(1);
    expect(report.programs).toHaveLength(1);
    expect(report.programs[0].title).toBe('Pantry, "East"');
  });

  it("is empty rather than wrong when the range has no hours", () => {
    const report = buildSharedReport(
      data(),
      { from: "2024-01-01", to: "2024-12-31" },
      { now: NOW },
    );

    expect(report.totals.verifiedMinutes).toBe(0);
    expect(report.programs).toEqual([]);
    expect(report.volunteers).toEqual([]);
    expect(report.hasData).toBe(false);
  });
});

describe("report ranges", () => {
  it("defaults to the year to date", () => {
    expect(defaultRange(NOW)).toEqual({ from: "2026-01-01", to: "2026-03-15" });
  });

  it("builds quarter, rolling and all-time windows from the same day", () => {
    expect(presetRange("ytd", NOW)).toEqual({ from: "2026-01-01", to: "2026-03-15" });
    expect(presetRange("90d", NOW)).toEqual({ from: "2025-12-16", to: "2026-03-15" });
    expect(presetRange("quarter", NOW)).toEqual({ from: "2026-01-01", to: "2026-03-15" });
    expect(presetRange("12m", NOW)).toEqual({ from: "2025-03-16", to: "2026-03-15" });
    expect(presetRange("all", NOW, data())).toEqual({ from: "2025-12-01", to: "2026-03-15" });
  });

  it("refuses to walk a reversed or mistyped range forever", () => {
    expect(monthKeys({ from: "2026-03-01", to: "2026-01-01" })).toEqual([]);
    expect(monthKeys({ from: "not-a-date", to: "2026-01-01" })).toEqual([]);
    expect(monthKeys({ from: "2000-01-01", to: "2026-12-31" })).toHaveLength(120);
  });
});

describe("report export", () => {
  it("writes every section and quotes a title with a comma", () => {
    const csv = reportToCsv(buildSharedReport(data(), RANGE, { now: NOW }));

    expect(csv).toContain("CivicFlow shared impact report");
    expect(csv).toContain("Period,2026-01-01 to 2026-03-31");
    expect(csv).toContain("Verified hours,4.50");
    expect(csv).toContain('"Pantry, ""East""",Hunger,1.50,1.00,1,1');
    expect(csv).toContain("Month,Verified hours,Pending hours");
    expect(csv).toContain("Alice Able,1.50,1.00,1,2026-01-10");
    expect(csv).toContain("Food handler,Alice Able,2026-01-01,expired");
  });

  it("neutralizes a name a spreadsheet would run as a formula", () => {
    const source = data();
    source.volunteers[0] = { ...source.volunteers[0], name: '=HYPERLINK("https://example.org")' };

    const csv = reportToCsv(buildSharedReport(source, RANGE, { now: NOW }));

    expect(csv).toContain('"\'=HYPERLINK(""https://example.org"")",1.50,1.00,1,2026-01-10');
  });
});
