import { csvRow } from "../csv";
import type { SharedRow } from "./sharedReplica";

/**
 * The coordinator's impact report over the shared organization.
 *
 * The numbers are derived from the replica the same way the local report is
 * derived from SQLite: dates come from the row, not from when the screen
 * happened to load. That keeps a report taken on two laptops identical, and it
 * lets the report work with the network down. Nothing here writes.
 */

export interface SharedReportData {
  opportunities: SharedRow[];
  shifts: SharedRow[];
  volunteers: SharedRow[];
  registrations: SharedRow[];
  attendance: SharedRow[];
  hourEntries: SharedRow[];
  credentials: SharedRow[];
  credentialTypes: SharedRow[];
}

export interface ReportRange {
  from: string;
  to: string;
}

export type ReportPreset = "ytd" | "90d" | "quarter" | "12m" | "all" | "custom";

export interface SharedReportProgram {
  id: string;
  title: string;
  cause: string;
  verifiedMinutes: number;
  pendingMinutes: number;
  volunteers: number;
  shiftsCompleted: number;
  attended: number;
}

export interface SharedReportMonth {
  key: string;
  verifiedMinutes: number;
  pendingMinutes: number;
}

export interface SharedReportVolunteer {
  id: string;
  name: string;
  verifiedMinutes: number;
  pendingMinutes: number;
  shifts: number;
  lastServed: string;
}

export type CredentialState = "valid" | "expiring" | "expired" | "unverified";

export interface SharedReportCredential {
  id: string;
  volunteerId: string;
  volunteerName: string;
  typeName: string;
  validThrough: string;
  state: CredentialState;
}

export interface SharedReport {
  from: string;
  to: string;
  generatedAt: string;
  totals: {
    verifiedMinutes: number;
    pendingMinutes: number;
    rejectedMinutes: number;
    volunteers: number;
    newVolunteers: number;
    shiftsCompleted: number;
    registrations: number;
    attended: number;
    noShows: number;
    attendanceRate: number;
  };
  programs: SharedReportProgram[];
  months: SharedReportMonth[];
  volunteers: SharedReportVolunteer[];
  credentials: {
    valid: number;
    expiring: number;
    expired: number;
    unverified: number;
    expiringSoon: SharedReportCredential[];
  };
  hasData: boolean;
}

export const EMPTY_REPORT_DATA: SharedReportData = {
  opportunities: [],
  shifts: [],
  volunteers: [],
  registrations: [],
  attendance: [],
  hourEntries: [],
  credentials: [],
  credentialTypes: [],
};

const EXPIRING_DAYS = 60;

export function text(row: SharedRow | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

function number(row: SharedRow | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === "number" ? value : Number(value) || 0;
}

function datePart(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export function localDateKey(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function shiftDate(row: SharedRow): string {
  const value = text(row, "starts_at");
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? datePart(value) : localDateKey(date);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setDate(parsed.getDate() + days);
  return localDateKey(parsed);
}

function inRange(date: string, range: ReportRange): boolean {
  return date !== "" && date >= range.from && date <= range.to;
}

export function monthKeys(range: ReportRange): string[] {
  const start = new Date(`${range.from}T12:00:00`);
  const end = new Date(`${range.to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
  const last = new Date(end.getFullYear(), end.getMonth(), 1, 12);
  // A report over decades is still a finite list; the cap keeps a mistyped
  // year from allocating thousands of empty buckets.
  while (cursor <= last && keys.length < 120) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

export function defaultRange(now: Date = new Date()): ReportRange {
  const today = localDateKey(now);
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

export function presetRange(
  preset: ReportPreset,
  now: Date = new Date(),
  data: SharedReportData = EMPTY_REPORT_DATA,
): ReportRange {
  const today = localDateKey(now);
  if (preset === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (preset === "90d") return { from: addDays(today, -89), to: today };
  if (preset === "quarter") {
    const date = new Date(`${today}T12:00:00`);
    const quarterStart = new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1, 12);
    return { from: localDateKey(quarterStart), to: today };
  }
  if (preset === "12m") {
    const date = new Date(`${today}T12:00:00`);
    date.setFullYear(date.getFullYear() - 1);
    return { from: addDays(localDateKey(date), 1), to: today };
  }
  if (preset === "all") {
    const dates = [
      ...data.hourEntries.map((row) => datePart(row.date)),
      ...data.shifts.map(shiftDate),
      ...data.registrations.map((row) => datePart(row.created_at)),
    ].filter(Boolean);
    const earliest = dates.sort()[0] ?? `${today.slice(0, 4)}-01-01`;
    return { from: earliest, to: today };
  }
  return defaultRange(now);
}

interface VolunteerTally {
  verifiedMinutes: number;
  pendingMinutes: number;
  shifts: Set<string>;
  lastServed: string;
}

interface ProgramTally {
  verifiedMinutes: number;
  pendingMinutes: number;
  volunteers: Set<string>;
  shiftsCompleted: number;
  attended: number;
}

export function buildSharedReport(
  data: SharedReportData,
  range: ReportRange,
  options: { now?: Date; opportunityId?: string } = {},
): SharedReport {
  const today = localDateKey(options.now ?? new Date());
  const opportunityId = options.opportunityId ?? "";
  const opportunities = new Map(data.opportunities.map((row) => [row.id, row]));
  const volunteers = new Map(data.volunteers.map((row) => [row.id, row]));
  const credentialTypes = new Map(data.credentialTypes.map((row) => [row.id, row]));

  const scopedShifts = data.shifts.filter(
    (row) =>
      (opportunityId === "" || text(row, "opportunity_id") === opportunityId) &&
      inRange(shiftDate(row), range),
  );
  const shiftIds = new Set(scopedShifts.map((row) => row.id));
  const completedShiftRows = scopedShifts.filter((row) => text(row, "status") === "completed");
  const completedByProgram = new Map<string, number>();
  const shiftProgram = new Map<string, string>();
  for (const row of scopedShifts) {
    shiftProgram.set(row.id, text(row, "opportunity_id"));
  }
  for (const row of completedShiftRows) {
    const programId = text(row, "opportunity_id");
    completedByProgram.set(programId, (completedByProgram.get(programId) ?? 0) + 1);
  }

  const hours = data.hourEntries.filter(
    (row) =>
      inRange(datePart(row.date), range) &&
      (opportunityId === "" || text(row, "opportunity_id") === opportunityId),
  );

  const totals = {
    verifiedMinutes: 0,
    pendingMinutes: 0,
    rejectedMinutes: 0,
    volunteers: 0,
    newVolunteers: 0,
    shiftsCompleted: completedShiftRows.length,
    registrations: 0,
    attended: 0,
    noShows: 0,
    attendanceRate: 0,
  };
  const verifiedVolunteers = new Set<string>();
  const perVolunteer = new Map<string, VolunteerTally>();
  const perProgram = new Map<string, ProgramTally>();
  const perMonth = new Map<string, { verifiedMinutes: number; pendingMinutes: number }>();

  // A program earns a row when it has hours, attendance or a completed shift.
  // Starting from the shifts keeps a program with attendance but no verified
  // hours from vanishing from the breakdown.
  for (const row of scopedShifts) {
    const programId = text(row, "opportunity_id");
    if (!perProgram.has(programId)) {
      perProgram.set(programId, {
        verifiedMinutes: 0,
        pendingMinutes: 0,
        volunteers: new Set<string>(),
        shiftsCompleted: 0,
        attended: 0,
      });
    }
  }

  for (const row of hours) {
    const status = text(row, "status");
    const minutes = number(row, "approved_minutes") || number(row, "minutes");
    const volunteerId = text(row, "volunteer_id");
    const programId = text(row, "opportunity_id");
    const month = datePart(row.date).slice(0, 7);

    if (status === "verified") {
      totals.verifiedMinutes += minutes;
      if (volunteerId) verifiedVolunteers.add(volunteerId);
      const tally = perVolunteer.get(volunteerId) ?? {
        verifiedMinutes: 0,
        pendingMinutes: 0,
        shifts: new Set<string>(),
        lastServed: "",
      };
      tally.verifiedMinutes += minutes;
      const shiftId = text(row, "source_shift_id");
      if (shiftId) tally.shifts.add(shiftId);
      const served = datePart(row.date);
      if (served > tally.lastServed) tally.lastServed = served;
      if (volunteerId) perVolunteer.set(volunteerId, tally);

      const program = perProgram.get(programId) ?? {
        verifiedMinutes: 0,
        pendingMinutes: 0,
        volunteers: new Set<string>(),
        shiftsCompleted: 0,
        attended: 0,
      };
      program.verifiedMinutes += minutes;
      if (volunteerId) program.volunteers.add(volunteerId);
      perProgram.set(programId, program);

      const monthTally = perMonth.get(month) ?? { verifiedMinutes: 0, pendingMinutes: 0 };
      monthTally.verifiedMinutes += minutes;
      perMonth.set(month, monthTally);
    } else if (status === "pending") {
      totals.pendingMinutes += minutes;
      const tally = perVolunteer.get(volunteerId) ?? {
        verifiedMinutes: 0,
        pendingMinutes: 0,
        shifts: new Set<string>(),
        lastServed: "",
      };
      tally.pendingMinutes += minutes;
      if (volunteerId) perVolunteer.set(volunteerId, tally);

      const program = perProgram.get(programId) ?? {
        verifiedMinutes: 0,
        pendingMinutes: 0,
        volunteers: new Set<string>(),
        shiftsCompleted: 0,
        attended: 0,
      };
      program.pendingMinutes += minutes;
      perProgram.set(programId, program);

      const monthTally = perMonth.get(month) ?? { verifiedMinutes: 0, pendingMinutes: 0 };
      monthTally.pendingMinutes += minutes;
      perMonth.set(month, monthTally);
    } else if (status === "rejected") {
      totals.rejectedMinutes += minutes;
    }
  }

  // A "new" volunteer is one whose first verified hour, anywhere in the
  // replica, falls inside this report's window.
  const firstVerified = new Map<string, string>();
  for (const row of data.hourEntries) {
    if (text(row, "status") !== "verified") continue;
    if (opportunityId !== "" && text(row, "opportunity_id") !== opportunityId) continue;
    const volunteerId = text(row, "volunteer_id");
    const date = datePart(row.date);
    if (!volunteerId || !date) continue;
    const current = firstVerified.get(volunteerId);
    if (!current || date < current) firstVerified.set(volunteerId, date);
  }
  for (const date of firstVerified.values()) {
    if (inRange(date, range)) totals.newVolunteers += 1;
  }

  for (const row of data.registrations) {
    const shiftId = text(row, "shift_id");
    if (!shiftIds.has(shiftId)) continue;
    if (text(row, "status") === "canceled") continue;
    totals.registrations += 1;
  }

  for (const row of data.attendance) {
    const shiftId = text(row, "shift_id");
    if (!shiftIds.has(shiftId)) continue;
    const status = text(row, "status");
    const volunteerId = text(row, "volunteer_id");
    if (status === "completed" || status === "checked_in") {
      totals.attended += 1;
      const programId = shiftProgram.get(shiftId) ?? "";
      const program = perProgram.get(programId);
      if (program) program.attended += 1;
    } else if (status === "no_show") {
      totals.noShows += 1;
    }
    if (volunteerId) verifiedVolunteers.add(volunteerId);
  }

  totals.volunteers = verifiedVolunteers.size;
  totals.attendanceRate =
    totals.attended + totals.noShows > 0
      ? Math.round((totals.attended / (totals.attended + totals.noShows)) * 100)
      : 0;

  const programs: SharedReportProgram[] = [...perProgram.entries()]
    .map(([id, tally]) => {
      const opportunity = opportunities.get(id);
      return {
        id,
        title: opportunity ? text(opportunity, "title") : "Unassigned",
        cause: opportunity ? text(opportunity, "cause") : "",
        verifiedMinutes: tally.verifiedMinutes,
        pendingMinutes: tally.pendingMinutes,
        volunteers: tally.volunteers.size,
        shiftsCompleted: completedByProgram.get(id) ?? 0,
        attended: tally.attended,
      };
    })
    .filter(
      (program) =>
        program.verifiedMinutes +
          program.pendingMinutes +
          program.attended +
          program.shiftsCompleted >
        0,
    )
    .sort((a, b) => b.verifiedMinutes - a.verifiedMinutes || a.title.localeCompare(b.title));

  const months = monthKeys(range).map((key) => ({
    key,
    verifiedMinutes: perMonth.get(key)?.verifiedMinutes ?? 0,
    pendingMinutes: perMonth.get(key)?.pendingMinutes ?? 0,
  }));

  const volunteerRows: SharedReportVolunteer[] = [...perVolunteer.entries()]
    .filter(([, tally]) => tally.verifiedMinutes + tally.pendingMinutes > 0)
    .map(([id, tally]) => ({
      id,
      name: text(volunteers.get(id), "name") || "Unknown volunteer",
      verifiedMinutes: tally.verifiedMinutes,
      pendingMinutes: tally.pendingMinutes,
      shifts: tally.shifts.size,
      lastServed: tally.lastServed,
    }))
    .sort(
      (a, b) =>
        b.verifiedMinutes - a.verifiedMinutes ||
        b.pendingMinutes - a.pendingMinutes ||
        a.name.localeCompare(b.name),
    );

  const credentialRows: SharedReportCredential[] = data.credentials.map((row) => {
    const validThrough = datePart(row.valid_through);
    const volunteerId = text(row, "volunteer_id");
    const verifiedAt = text(row, "verified_at");
    const state: CredentialState = !verifiedAt
      ? "unverified"
      : validThrough !== "" && validThrough < today
        ? "expired"
        : validThrough !== "" && validThrough <= addDays(today, EXPIRING_DAYS)
          ? "expiring"
          : "valid";
    return {
      id: row.id,
      volunteerId,
      volunteerName: text(volunteers.get(volunteerId), "name") || "Unknown volunteer",
      typeName: text(credentialTypes.get(text(row, "credential_type_id")), "name") || "Credential",
      validThrough,
      state,
    };
  });

  const credentials = {
    valid: credentialRows.filter((row) => row.state === "valid").length,
    expiring: credentialRows.filter((row) => row.state === "expiring").length,
    expired: credentialRows.filter((row) => row.state === "expired").length,
    unverified: credentialRows.filter((row) => row.state === "unverified").length,
    expiringSoon: credentialRows
      .filter((row) => row.state === "expiring" || row.state === "expired")
      .sort((a, b) => a.validThrough.localeCompare(b.validThrough)),
  };

  return {
    from: range.from,
    to: range.to,
    generatedAt: today,
    totals,
    programs,
    months,
    volunteers: volunteerRows,
    credentials,
    hasData:
      totals.verifiedMinutes > 0 ||
      totals.pendingMinutes > 0 ||
      totals.registrations > 0 ||
      totals.shiftsCompleted > 0,
  };
}

function hours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** A spreadsheet-ready copy of the screen, including the formulas behind it. */
export function reportToCsv(report: SharedReport): string {
  const lines: string[] = [];
  lines.push(csvRow(["CivicFlow shared impact report"]));
  lines.push(csvRow(["Period", `${report.from} to ${report.to}`]));
  lines.push(csvRow(["Generated", report.generatedAt]));
  lines.push("");
  lines.push(csvRow(["Summary", "Value"]));
  lines.push(csvRow(["Verified hours", hours(report.totals.verifiedMinutes)]));
  lines.push(csvRow(["Pending hours", hours(report.totals.pendingMinutes)]));
  lines.push(csvRow(["Rejected hours", hours(report.totals.rejectedMinutes)]));
  lines.push(csvRow(["Volunteers", report.totals.volunteers]));
  lines.push(csvRow(["New volunteers", report.totals.newVolunteers]));
  lines.push(csvRow(["Shifts completed", report.totals.shiftsCompleted]));
  lines.push(csvRow(["Registrations", report.totals.registrations]));
  lines.push(csvRow(["Attended", report.totals.attended]));
  lines.push(csvRow(["No-shows", report.totals.noShows]));
  lines.push(csvRow(["Attendance rate", `${report.totals.attendanceRate}%`]));
  lines.push("");
  lines.push(
    csvRow(["Program", "Cause", "Verified hours", "Pending hours", "Volunteers", "Attended"]),
  );
  for (const program of report.programs) {
    lines.push(
      csvRow([
        program.title,
        program.cause,
        hours(program.verifiedMinutes),
        hours(program.pendingMinutes),
        program.volunteers,
        program.attended,
      ]),
    );
  }
  lines.push("");
  lines.push(csvRow(["Month", "Verified hours", "Pending hours"]));
  for (const month of report.months) {
    lines.push(csvRow([month.key, hours(month.verifiedMinutes), hours(month.pendingMinutes)]));
  }
  lines.push("");
  lines.push(csvRow(["Volunteer", "Verified hours", "Pending hours", "Shifts", "Last served"]));
  for (const volunteer of report.volunteers) {
    lines.push(
      csvRow([
        volunteer.name,
        hours(volunteer.verifiedMinutes),
        hours(volunteer.pendingMinutes),
        volunteer.shifts,
        volunteer.lastServed,
      ]),
    );
  }
  lines.push("");
  lines.push(csvRow(["Credential", "Volunteer", "Valid through", "State"]));
  for (const credential of report.credentials.expiringSoon) {
    lines.push(
      csvRow([
        credential.typeName,
        credential.volunteerName,
        credential.validThrough,
        credential.state,
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}
