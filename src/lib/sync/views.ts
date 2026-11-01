/**
 * Views are pure functions of cached rows. A screen never invents a seat
 * count or an eligibility rule: the server's row is rendered as it arrived.
 */

export type Row = Record<string, unknown>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export interface RoleView {
  name: string;
  required: number;
  filled: number;
}

export interface RegistrationView {
  id: string;
  status: string;
  role: string;
}

export interface AttendanceView {
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

export interface ShiftView {
  id: string;
  opportunityId: string;
  title: string;
  cause: string;
  organizationName: string;
  address: string;
  image: string;
  imageAlt: string;
  description: string;
  impactMetric: string;
  requirements: string[];
  startsAt: string;
  endsAt: string;
  capacity: number;
  confirmed: number;
  waitlisted: number;
  status: string;
  roles: RoleView[];
  registration: RegistrationView | null;
  waitlistPosition: number | null;
  attendance: AttendanceView | null;
  canRegister: boolean;
  canCancel: boolean;
  canCheckIn: boolean;
  canCheckOut: boolean;
  seatsLeft: number;
  pending: boolean;
}

export interface HourView {
  id: string;
  date: string;
  minutes: number;
  approvedMinutes: number | null;
  status: string;
  opportunityTitle: string;
  note: string;
}

export interface CredentialView {
  id: string;
  name: string;
  identifier: string;
  validThrough: string;
  status: string;
}

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  priority: string;
  createdAt: string;
  readAt: string | null;
  href: string;
}

export interface VolunteerView {
  volunteerId: string;
  name: string;
  firstName: string;
  initials: string;
  email: string;
  phone: string;
  status: string;
  memberSince: string;
  interests: string;
  skills: string[];
  causes: string[];
  availability: string[];
  photo: string;
  rowVersion: number;
  shifts: ShiftView[];
  upcoming: ShiftView[];
  past: ShiftView[];
  hours: HourView[];
  approvedMinutes: number;
  pendingMinutes: number;
  credentials: CredentialView[];
  notifications: NotificationView[];
  savedOpportunityIds: string[];
}

export interface ViewInput {
  now: string;
  volunteerId: string;
  rows: {
    volunteers: Row[];
    opportunities: Row[];
    shifts: Row[];
    roles: Row[];
    registrations: Row[];
    waitlist: Row[];
    attendance: Row[];
    hours: Row[];
    credentials: Row[];
    credentialTypes: Row[];
    notifications: Row[];
    saved: Row[];
  };
  /** Shift ids with a queued command that has not reached the server yet. */
  pendingShiftIds?: string[];
}

function listFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function shiftWindow(
  now: string,
  startsAt: string,
  endsAt: string,
): {
  canCheckIn: boolean;
  canCheckOut: boolean;
  started: boolean;
  ended: boolean;
} {
  const current = Date.parse(now);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { canCheckIn: false, canCheckOut: false, started: false, ended: false };
  }
  // The hosted command and the desktop share one policy: self check-in opens
  // 30 minutes before the shift and closes 15 minutes after it starts. Checking
  // out stays available until the shift ends.
  return {
    canCheckIn: current >= start - 30 * 60_000 && current <= start + 15 * 60_000,
    canCheckOut: current >= start - 30 * 60_000 && current <= end,
    started: current >= start,
    ended: current > end,
  };
}

export function buildVolunteerView(input: ViewInput): VolunteerView {
  const volunteer = input.rows.volunteers.find((row) => text(row.id) === input.volunteerId) ?? {};
  const pending = new Set(input.pendingShiftIds ?? []);
  const opportunityById = new Map(input.rows.opportunities.map((row) => [text(row.id), row]));
  const credentialTypeById = new Map(input.rows.credentialTypes.map((row) => [text(row.id), row]));

  const shifts = input.rows.shifts
    .map((shift): ShiftView | null => {
      const id = text(shift.id);
      const opportunity = opportunityById.get(text(shift.opportunity_id)) ?? {};
      const startsAt = text(shift.starts_at);
      const endsAt = text(shift.ends_at);
      if (!id || !startsAt || !endsAt) return null;
      const roles = input.rows.roles
        .filter((role) => text(role.shift_id) === id)
        .map((role) => ({
          name: text(role.name),
          required: num(role.required),
          filled: num(role.filled),
        }));
      const registration =
        input.rows.registrations.find(
          (row) =>
            text(row.shift_id) === id &&
            text(row.volunteer_id) === input.volunteerId &&
            ["registered", "confirmed", "completed", "no_show"].includes(text(row.status)),
        ) ?? null;
      const waitlist =
        input.rows.waitlist.find(
          (row) =>
            text(row.shift_id) === id &&
            text(row.volunteer_id) === input.volunteerId &&
            text(row.status) === "waiting",
        ) ?? null;
      const attendance =
        input.rows.attendance.find(
          (row) => text(row.shift_id) === id && text(row.volunteer_id) === input.volunteerId,
        ) ?? null;
      const window = shiftWindow(input.now, startsAt, endsAt);
      const status = text(shift.status, "scheduled");
      const capacity = num(shift.capacity);
      const confirmed = num(shift.confirmed);
      const checkedIn = attendance ? text(attendance.status) === "checked_in" : false;
      const checkedOut = attendance ? text(attendance.status) === "completed" : false;
      return {
        id,
        opportunityId: text(shift.opportunity_id),
        title: text(opportunity.title, "Untitled opportunity"),
        cause: text(opportunity.cause),
        organizationName: text(opportunity.organization_name),
        address: text(opportunity.address),
        image: text(opportunity.image),
        imageAlt: text(opportunity.image_alt),
        description: text(opportunity.description),
        impactMetric: text(opportunity.impact_metric),
        requirements: listFrom(opportunity.requirements),
        startsAt,
        endsAt,
        capacity,
        confirmed,
        waitlisted: num(shift.waitlisted),
        status,
        roles,
        registration: registration
          ? {
              id: text(registration.id),
              status: text(registration.status),
              role: text(registration.role),
            }
          : null,
        waitlistPosition: waitlist ? num(waitlist.position) : null,
        attendance: attendance
          ? {
              status: text(attendance.status),
              checkedInAt: text(attendance.checked_in_at) || null,
              checkedOutAt: text(attendance.checked_out_at) || null,
            }
          : null,
        canRegister:
          status === "scheduled" &&
          registrationOpen(input.now, endsAt) &&
          registration === null &&
          waitlist === null,
        canCancel: registration !== null && !window.ended && !checkedIn,
        canCheckIn: registration !== null && window.canCheckIn && !checkedIn && !checkedOut,
        canCheckOut: checkedIn && window.canCheckOut,
        seatsLeft: Math.max(capacity - confirmed, 0),
        pending: pending.has(id),
      };
    })
    .filter((shift): shift is ShiftView => shift !== null)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

  const current = Date.parse(input.now);
  const upcoming = shifts.filter(
    (shift) => Date.parse(shift.endsAt) >= current && shift.status !== "canceled",
  );
  const past = shifts
    .filter((shift) => Date.parse(shift.endsAt) < current || shift.status === "canceled")
    .reverse();

  const opportunityTitle = new Map(
    input.rows.opportunities.map((row) => [text(row.id), text(row.title)]),
  );
  const hours = input.rows.hours
    .filter((row) => text(row.volunteer_id) === input.volunteerId)
    .map((row) => ({
      id: text(row.id),
      date: text(row.date),
      minutes: num(row.minutes),
      approvedMinutes: typeof row.approved_minutes === "number" ? num(row.approved_minutes) : null,
      status: text(row.status, "pending"),
      opportunityTitle: opportunityTitle.get(text(row.opportunity_id)) ?? "",
      note: text(row.note),
    }))
    .sort((left, right) => right.date.localeCompare(left.date));

  const today = input.now.slice(0, 10);
  const credentials = input.rows.credentials
    .filter((row) => text(row.volunteer_id) === input.volunteerId)
    .map((row) => {
      const validThrough = text(row.valid_through);
      const days = Math.round((Date.parse(validThrough) - Date.parse(today)) / 86_400_000);
      return {
        id: text(row.id),
        name: text(credentialTypeById.get(text(row.credential_type_id))?.name, "Credential"),
        identifier: text(row.identifier),
        validThrough,
        status: days < 0 ? "expired" : days <= 30 ? "expiring" : "current",
      };
    })
    .sort((left, right) => left.validThrough.localeCompare(right.validThrough));

  const notifications = input.rows.notifications
    .filter((row) => {
      const audience = text(row.audience, "coordinator");
      const target = text(row.volunteer_id);
      return audience === "all" || (audience === "volunteer" && target === input.volunteerId);
    })
    .map((row) => ({
      id: text(row.id),
      kind: text(row.kind),
      title: text(row.title),
      body: text(row.body),
      priority: text(row.priority, "normal"),
      createdAt: text(row.created_at),
      readAt: text(row.read_at) || null,
      href: text(row.href),
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const approvedMinutes = hours
    .filter((entry) => entry.status === "verified")
    .reduce((total, entry) => total + (entry.approvedMinutes ?? entry.minutes), 0);
  const pendingMinutes = hours
    .filter((entry) => entry.status === "pending")
    .reduce((total, entry) => total + entry.minutes, 0);

  return {
    volunteerId: input.volunteerId,
    name: text(volunteer.name, "Volunteer"),
    firstName:
      text(volunteer.first_name) || text(volunteer.name, "Volunteer").split(" ")[0] || "Volunteer",
    initials: text(volunteer.initials, "CF"),
    email: text(volunteer.email),
    phone: text(volunteer.phone),
    status: text(volunteer.status, "active"),
    memberSince: text(volunteer.joined_at),
    interests: text(volunteer.interests),
    skills: listFrom(volunteer.skills),
    causes: listFrom(volunteer.causes),
    availability: listFrom(volunteer.availability),
    photo: text(volunteer.photo),
    rowVersion: num(volunteer.row_version, 1),
    shifts,
    upcoming,
    past,
    hours,
    approvedMinutes,
    pendingMinutes,
    credentials,
    notifications,
    savedOpportunityIds: input.rows.saved
      .filter((row) => text(row.volunteer_id) === input.volunteerId)
      .map((row) => text(row.opportunity_id)),
  };
}

/**
 * Registration closes when the shift ends. The server has the final say; this
 * only keeps a button from inviting an action the server would refuse.
 */
export function registrationOpen(now: string, endsAt: string): boolean {
  const end = Date.parse(endsAt);
  return Number.isFinite(end) && Date.parse(now) <= end;
}

export function formatShiftRange(
  startsAt: string,
  endsAt: string,
  timezone: string,
): { day: string; time: string; duration: string } {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(start);
  const time = `${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(start)} – ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(end)}`;
  const minutes = Math.max(Math.round((end.getTime() - start.getTime()) / 60_000), 0);
  const duration =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
      : `${minutes}m`;
  return { day, time, duration };
}
