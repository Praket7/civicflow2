/**
 * Browser fallback for the workflow store: mirrors the snapshot contract over
 * the shared seed and localStorage. Chosen by `getWorkspaceRepository()` when
 * there is no native host.
 */

import rawSessionSeed from "../../../shared/session-seed.json";
import { csvText, downloadCsv } from "../csv";
import rawWorkspace from "../../../shared/demo-workspace.json";
import type {
  Account,
  AccountRole,
  Applicant,
  AttendanceEntry,
  AuditEvent,
  BackupRestoreResult,
  BackupSnapshot,
  CandidateAnswer,
  Cause,
  CheckinCode,
  CheckinStatus,
  CheckinWindow,
  ConstraintCheck,
  Credential,
  AuthSession,
  DayKey,
  DemoWorkspace,
  DisruptedRole,
  DisruptedShift,
  DisruptionReport,
  ForcedComparison,
  HoursDecision,
  ImpactMetric,
  InstallationAccess,
  MatchExplanation,
  NewOpportunityInput,
  Opportunity,
  PeriodKey,
  PlannedAssignment,
  PriorityLevel,
  ReportDocument,
  ReportRequest,
  ReportSummaryItem,
  RetentionCohort,
  CredentialReadiness,
  EngagementMetrics,
  Milestone,
  NotificationRule,
  NotificationRulePatch,
  RecurrenceRule,
  RecoveryChange,
  RecoveryChangeRequest,
  RecoveryPlan,
  RecoverySeat,
  ReplacementRecommendation,
  RetentionSignal,
  CandidateEvaluation,
  EvaluatedSlot,
  RosterApplyAssignment,
  RosterEvaluation,
  RosterOptions,
  RosterPlan,
  RosterPolicy,
  RosterPolicyView,
  RosterVolunteer,
  SavedViewRecord,
  ScoreComponent,
  SeriesResult,
  ServiceVerification,
  SessionSnapshot,
  ShiftSeriesRecord,
  VolunteerInsight,
  WaitlistCandidate,
  Volunteer,
  VolunteerImportPreview,
  WaitlistEntry,
  WorkspaceSettings,
} from "../../types/domain";
import * as previewOrganizations from "../organizations/preview";
import { buildMissionControl } from "./compute";
import { demoWorkspace } from "./dataset";
import { blankWorkspaceForOrganization, withRoster } from "./organizationWorkspace";
import type { OrganizationScope } from "./organizationWorkspace";
import type { WorkspaceRepository } from "./repository";

const STORAGE_KEY = "civicflow.workflow.v1";
const READ_KEY = "civicflow.notifications.read";
const BACKUP_KEY = "civicflow.backups.v1";

/**
 * Each organization has its own workflow overlay; the demo keeps the original
 * keys and an account with no organization reads an empty store.
 */
const DEMO_ORGANIZATION_ID = demoWorkspace.organization.id;
const NO_ORGANIZATION_ID = "no-organization";

const DEMO_SCOPE: OrganizationScope = {
  id: demoWorkspace.organization.id,
  name: demoWorkspace.organization.name,
};

let organization: OrganizationScope | null = DEMO_SCOPE;

function scopeId(): string {
  return organization?.id ?? NO_ORGANIZATION_ID;
}

function scoped(key: string): string {
  return scopeId() === DEMO_ORGANIZATION_ID ? key : `${key}:${scopeId()}`;
}
const BACKUP_RETENTION = 20;
const PREVIEW_ACCOUNT_KEY = "civicflow.auth.passwords";
const PREVIEW_ACCOUNTS_KEY = "civicflow.auth.accounts";

/** Accounts created in a previous preview session, newest last. */
function storedPreviewAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(PREVIEW_ACCOUNTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is Account => {
      const candidate = row as Partial<Account> | null;
      return Boolean(
        candidate &&
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.email === "string" &&
        (candidate.role === "coordinator" ||
          candidate.role === "volunteer" ||
          candidate.role === "none"),
      );
    });
  } catch {
    return [];
  }
}

function previewPasswords(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PREVIEW_ACCOUNT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch {
    // The preview keeps the demo password when storage is unavailable.
  }
  return {};
}

/** The identity the preview screens are operating as. */
let activePreviewAccount: Account | null = null;

function requirePreviewAccount(): Account {
  if (activePreviewAccount) return activePreviewAccount;
  const demo = previewAccounts.find((row) => row.role !== "none") ?? previewAccounts[0];
  if (!demo) throw new Error("Sign in before opening an organization.");
  return demo;
}

/**
 * The role comes from the selected membership, not the identity row stored at
 * sign-up.
 */
function withLiveRole(account: Account): Account {
  const access = previewOrganizations.active(account);
  if (!access) return account;
  const role: AccountRole = access.membership.role === "volunteer" ? "volunteer" : "coordinator";
  if (role === "coordinator") return { ...account, role, volunteerId: null };
  const matching = workspace.volunteers.find(
    (volunteer) => volunteer.email?.toLowerCase() === account.email.toLowerCase(),
  );
  return { ...account, role, volunteerId: matching?.id ?? account.volunteerId };
}

function previewAccountFromToken(token: string): Account | null {
  const match = /^preview:([^:]+):([^:]+)$/.exec(token);
  if (!match) return null;
  const account = previewAccounts.find((row) => row.id === match[1]);
  if (!account) return null;
  const expected = previewPasswords()[account.id] ?? "demo";
  return expected === match[2] ? withLiveRole(account) : null;
}

function previewToken(account: Account): string {
  const version = previewPasswords()[account.id] ?? "demo";
  return `preview:${account.id}:${version}`;
}

interface SessionSeed {
  savedOpportunityIds: string[];
  waitlist: WaitlistEntry[];
  applications: Applicant[];
  audit: AuditEvent[];
  settings: WorkspaceSettings;
}

const demoSeed = rawSessionSeed as unknown as SessionSeed;
const demoWorkspaceData = rawWorkspace as unknown as DemoWorkspace;

let seed: SessionSeed = demoSeed;
let workspace: DemoWorkspace = demoWorkspaceData;
let current = workspace.volunteers.find(
  (volunteer) => volunteer.id === workspace.currentVolunteerId,
);

/** Settings for an organization nobody has set up yet: no demo identity. */
function blankSeed(organization: OrganizationScope | null): SessionSeed {
  return {
    savedOpportunityIds: [],
    waitlist: [],
    applications: [],
    audit: [],
    settings: {
      ...demoSeed.settings,
      organizationName: organization?.name ?? "Your organization",
      contactEmail: organization?.contactEmails?.[0] ?? "",
    },
  };
}

function revisionKey(): string {
  return scoped("civicflow.workspace-revision.v1");
}

function loadRevision(): number {
  try {
    const value = Number(localStorage.getItem(revisionKey()));
    return Number.isFinite(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

function bumpRevision(): void {
  revision += 1;
  try {
    localStorage.setItem(revisionKey(), String(revision));
  } catch {
    // The in-memory counter still guards the open session.
  }
}

function applyScope(next: OrganizationScope | null): void {
  organization = next;
  if (next && next.id === DEMO_ORGANIZATION_ID) {
    workspace = demoWorkspaceData;
    seed = demoSeed;
  } else {
    const coordinator: Account | null = next?.coordinatorName
      ? {
          id: "scope-coordinator",
          name: next.coordinatorName,
          email: next.coordinatorEmail ?? "",
          role: "coordinator",
          volunteerId: null,
        }
      : null;
    workspace = blankWorkspaceForOrganization(next, coordinator);
    seed = blankSeed(next);
  }
  current = workspace.volunteers.find((volunteer) => volunteer.id === workspace.currentVolunteerId);
  state = loadSnapshot();
  revision = loadRevision();
}

const seededAccounts: Account[] = [
  {
    id: "user-praket",
    name: "Praket Gauri",
    email: "praket@rivergate.example",
    role: "coordinator",
    volunteerId: null,
  },
  {
    id: "user-maya",
    name: current?.name ?? "Maya Chen",
    email: current?.email ?? "maya.chen@example.org",
    role: "volunteer",
    volunteerId: current?.id ?? workspace.currentVolunteerId,
  },
];

const previewAccounts: Account[] = [...seededAccounts, ...storedPreviewAccounts()];

function defaultCredentials(): Credential[] {
  return workspace.credentials.map((credential) => {
    const today = workspace.now.slice(0, 10);
    const status =
      credential.validThrough < today
        ? "expired"
        : credential.validThrough <=
            new Date(new Date(workspace.now).getTime() + 45 * 86_400_000).toISOString().slice(0, 10)
          ? "expiring"
          : "current";
    return { ...credential, status };
  });
}

function defaultVerifications(): ServiceVerification[] {
  const groups = new Map<string, ServiceVerification>();
  for (const entry of [...workspace.hourEntries, ...workspace.mayaEntries]) {
    if (entry.status !== "verified" || !entry.verificationId) continue;
    const existing = groups.get(entry.verificationId);
    if (existing) {
      existing.totalMinutes += entry.minutes;
      existing.dateStart = existing.dateStart < entry.date ? existing.dateStart : entry.date;
      existing.dateEnd = existing.dateEnd > entry.date ? existing.dateEnd : entry.date;
    } else {
      groups.set(entry.verificationId, {
        id: `verification-${entry.verificationId}`,
        code: entry.verificationId,
        volunteerId: entry.volunteerId,
        organizationId: workspace.organization.id,
        dateStart: entry.date,
        dateEnd: entry.date,
        totalMinutes: entry.minutes,
        issuedAt: workspace.now,
        issuedBy: workspace.coordinator.name,
      });
    }
  }
  return [...groups.values()];
}

function defaultImpactMetrics(): ImpactMetric[] {
  return workspace.impactRecords.map((record) => ({ ...record }));
}

function defaultRetention(): RetentionCohort[] {
  const dates = [...workspace.hourEntries, ...workspace.mayaEntries].map((entry) => entry.date);
  const byMonth = new Map<string, number>();
  for (const date of dates) byMonth.set(date.slice(0, 7), (byMonth.get(date.slice(0, 7)) ?? 0) + 1);
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, eligible]) => ({
      label: new Date(`${month}-01T12:00:00`).toLocaleString("en-US", { month: "short" }),
      eligible,
      returned: Math.round(eligible * 0.62),
      rate: 62,
    }));
}

function defaultAttendance(): SessionSnapshot["attendance"] {
  const arrivedAt = new Date(new Date(workspace.now).getTime() - 18 * 60_000).toISOString();
  const rows = workspace.registrations
    .filter(
      (row) => row.shiftId === "sh-tue-pantry" && row.volunteerId !== workspace.currentVolunteerId,
    )
    .slice(0, 2)
    .map((row) => ({
      volunteerId: row.volunteerId,
      shiftId: row.shiftId,
      role: row.role,
      status: "checked_in" as const,
      checkedInAt: arrivedAt,
      checkedOutAt: null,
    }));
  return rows.length > 0 ? { "sh-tue-pantry": rows } : {};
}

function defaultSavedViews(): SavedViewRecord[] {
  return workspace.savedViews.map((view) => ({
    id: view.id,
    scope: "records",
    name: view.name,
    filtersJson: JSON.stringify(view.filters),
    createdAt: workspace.now,
  }));
}

export function createDefaultSnapshot(): SessionSnapshot {
  return {
    savedOpportunityIds: [...seed.savedOpportunityIds],
    attendance: defaultAttendance(),
    hoursDecisions: {},
    applications: seed.applications.map((applicant) => ({ ...applicant })),
    waitlist: seed.waitlist.map((entry) => ({ ...entry })),
    settings: { ...seed.settings },
    createdOpportunities: [],
    registrations: workspace.registrations.map((row) => ({ ...row })),
    audit: seed.audit.map((event) => ({ ...event })),
    volunteerProfile: {
      skills: current?.skills ?? [],
      availability: current?.availability ?? [],
      completedOnboarding: true,
      phone: current?.phone ?? "",
      interests: current?.interests ?? "",
      causes: current?.causes ?? [],
      photo: current?.photo ?? "",
    },
    credentials: defaultCredentials(),
    verifications: defaultVerifications(),
    impactMetrics: defaultImpactMetrics(),
    savedViews: defaultSavedViews(),
    retention: defaultRetention(),
    checkinCode: null,
    roster: workspaceRoster(),
  };
}

function readIds(): string[] {
  try {
    const raw = localStorage.getItem(scoped(READ_KEY));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string")
      ? (parsed as string[])
      : [];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  try {
    localStorage.setItem(scoped(READ_KEY), JSON.stringify([...new Set(ids)]));
  } catch {
    // Storage can be unavailable in hardened webviews; the fallback still works.
  }
}

function loadSnapshot(): SessionSnapshot {
  const fallback = createDefaultSnapshot();
  try {
    const raw = localStorage.getItem(scoped(STORAGE_KEY));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
    return {
      ...fallback,
      ...parsed,
      applications: Array.isArray(parsed.applications)
        ? parsed.applications
        : fallback.applications,
      waitlist: Array.isArray(parsed.waitlist) ? parsed.waitlist : fallback.waitlist,
      audit: Array.isArray(parsed.audit) ? parsed.audit : fallback.audit,
      settings: { ...fallback.settings, ...(parsed.settings ?? {}) },
      volunteerProfile: { ...fallback.volunteerProfile, ...(parsed.volunteerProfile ?? {}) },
    };
  } catch {
    return fallback;
  }
}

let state = loadSnapshot();
let revision = loadRevision();

interface StoredBackup {
  meta: BackupSnapshot;
  snapshot: SessionSnapshot;
}

function previewChecksum(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let index = 0; index < value.length; index += 1) {
    h1 = Math.imul(h1 ^ value.charCodeAt(index), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + value.charCodeAt(index), 0x85ebca6b) >>> 0;
  }
  const block = (seed: number) => seed.toString(16).padStart(8, "0");
  return (block(h1) + block(h2) + block(h1 ^ h2) + block(h1 + h2)).repeat(2);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validSnapshot(value: unknown): value is SessionSnapshot {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.savedOpportunityIds) &&
    isRecord(value.attendance) &&
    isRecord(value.hoursDecisions) &&
    Array.isArray(value.applications) &&
    Array.isArray(value.waitlist) &&
    isRecord(value.settings) &&
    Array.isArray(value.createdOpportunities) &&
    Array.isArray(value.registrations) &&
    Array.isArray(value.audit) &&
    isRecord(value.volunteerProfile) &&
    Array.isArray(value.credentials) &&
    Array.isArray(value.verifications) &&
    Array.isArray(value.impactMetrics) &&
    Array.isArray(value.savedViews) &&
    Array.isArray(value.retention)
  );
}

function backupCounts(snapshot: SessionSnapshot) {
  return {
    volunteers: workspace.volunteers.length,
    programs: workspace.opportunities.length,
    shifts: workspace.shifts.length,
    hours: workspace.hourEntries.length + workspace.mayaEntries.length,
    notifications: workspace.notifications.length,
    audit: snapshot.audit.length,
  };
}

function backupRows(snapshot: SessionSnapshot): number {
  const counts = backupCounts(snapshot);
  return (
    counts.volunteers +
    counts.programs +
    counts.shifts +
    counts.hours +
    counts.notifications +
    counts.audit +
    snapshot.savedOpportunityIds.length +
    snapshot.applications.length +
    snapshot.waitlist.length +
    snapshot.registrations.length +
    Object.values(snapshot.attendance).flat().length +
    Object.keys(snapshot.hoursDecisions).length
  );
}

function makeBackup(
  snapshot: SessionSnapshot,
  kind: BackupSnapshot["kind"],
  note: string,
): StoredBackup {
  const stored: StoredBackup = {
    meta: {
      id: `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      kind,
      bytes: 0,
      rows: backupRows(snapshot),
      note,
      counts: backupCounts(snapshot),
      sha256: "",
      schemaVersion: 3,
      integrity: "ok",
    },
    snapshot: clone(snapshot),
  };
  const payload = JSON.stringify(stored.snapshot);
  stored.meta.bytes = new TextEncoder().encode(payload).length;
  stored.meta.sha256 = previewChecksum(payload);
  return stored;
}

function readBackups(): StoredBackup[] {
  try {
    const raw = localStorage.getItem(scoped(BACKUP_KEY));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is StoredBackup => {
        if (!isRecord(entry) || !isRecord(entry.meta) || !isRecord(entry.snapshot)) return false;
        const meta = entry.meta;
        return (
          typeof meta.id === "string" &&
          typeof meta.createdAt === "string" &&
          (meta.kind === "manual" || meta.kind === "automatic") &&
          typeof meta.bytes === "number" &&
          typeof meta.rows === "number" &&
          typeof meta.note === "string" &&
          isRecord(meta.counts)
        );
      })
      .map((entry) => ({
        ...entry,
        meta: {
          ...entry.meta,
          sha256: entry.meta.sha256 || previewChecksum(JSON.stringify(entry.snapshot)),
          schemaVersion: entry.meta.schemaVersion || 3,
          integrity: entry.meta.integrity || "ok",
        },
      }));
  } catch {
    return [];
  }
}

function writeBackups(backups: StoredBackup[]): void {
  try {
    localStorage.setItem(scoped(BACKUP_KEY), JSON.stringify(backups.slice(0, BACKUP_RETENTION)));
  } catch {
    // The current session can still create and restore in memory.
  }
}

function ensureBackups(): StoredBackup[] {
  const stored = readBackups();
  if (stored.length > 0) {
    if (stored.length > BACKUP_RETENTION) {
      const retained = stored.slice(0, BACKUP_RETENTION);
      writeBackups(retained);
      return retained;
    }
    return stored;
  }
  const baseline = makeBackup(state, "automatic", "Initial workspace snapshot");
  writeBackups([baseline]);
  return [baseline];
}

function listBackupMeta(): BackupSnapshot[] {
  return ensureBackups().map((entry) => entry.meta);
}

function persist(next: SessionSnapshot): SessionSnapshot {
  state = next;
  bumpRevision();
  try {
    localStorage.setItem(scoped(STORAGE_KEY), JSON.stringify(next));
  } catch {
    // The in-memory store is enough when storage is refused.
  }
  return next;
}

function audit(
  action: string,
  entityType: AuditEvent["entityType"],
  entityId: string,
  summary: string,
  detail?: string,
): AuditEvent {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: workspace.now,
    actor: workspace.coordinator.name,
    action,
    entityType,
    entityId,
    summary,
    detail,
  };
}

function previewCheckinCode(shiftId: string): string {
  const window = Math.floor(new Date(workspace.now).getTime() / (15 * 60_000));
  const seed = `${shiftId}:${window}`;
  let hash = 0xcbf29ce4;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String(hash % 1_000_000).padStart(6, "0");
}

// Browser preview mirrors the Rust self check-in window.
const SELF_CHECKIN_OPEN_BEFORE_MINUTES = 30;
const SELF_CHECKIN_CLOSE_AFTER_MINUTES = 15;

function previewCheckinWindow(shiftId: string): CheckinWindow {
  const shift =
    workspace.shifts.find((row) => row.id === shiftId) ??
    (state.createdShifts ?? []).find((row) => row.id === shiftId);
  if (!shift) throw new Error("That shift is no longer available.");
  const startsAt = new Date(shift.startsAt).getTime();
  const opensAt = new Date(startsAt - SELF_CHECKIN_OPEN_BEFORE_MINUTES * 60_000);
  const closesAt = new Date(startsAt + SELF_CHECKIN_CLOSE_AFTER_MINUTES * 60_000);
  const now = new Date(workspace.now).getTime();
  const status: CheckinStatus =
    now < opensAt.getTime() ? "not_open" : now > closesAt.getTime() ? "closed" : "open";
  return {
    shiftId,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
    status,
    canSelfCheckIn: status === "open",
  };
}

function volunteerName(id: string): string {
  return workspace.volunteers.find((volunteer) => volunteer.id === id)?.name ?? "Volunteer";
}

function volunteerRole(id: string): string {
  return (
    workspace.volunteers.find((volunteer) => volunteer.id === id)?.skills[0] ?? "General support"
  );
}

/** The role a volunteer holds on a shift, as the registration records it. */
function registeredRole(shiftId: string, volunteerId: string): string {
  return (
    state.registrations.find(
      (row) =>
        row.shiftId === shiftId && row.volunteerId === volunteerId && row.status !== "canceled",
    )?.role ?? volunteerRole(volunteerId)
  );
}

/**
 * Counts the registration rows, which the seed's own totals predate. Mission
 * Control and Schedule must agree on these numbers.
 */
function countedWorkspace(): DemoWorkspace {
  return {
    ...workspace,
    shifts: workspace.shifts.map((shift) => {
      const live = state.registrations.filter(
        (row) => row.shiftId === shift.id && row.status === "registered",
      );
      return {
        ...shift,
        confirmed: live.length,
        waitlisted: state.waitlist.filter(
          (row) => row.shiftId === shift.id && row.status === "waiting",
        ).length,
        roles: shift.roles.map((role) => ({
          ...role,
          filled: live.filter((row) => row.role === role.name).length,
        })),
      };
    }),
  };
}

/// Matches the desktop core: attendance row, audit entry, and the reason together.
function recordArrival(
  snapshot: SessionSnapshot,
  shiftId: string,
  volunteerId: string,
  action: "shift.checkin" | "shift.manual_checkin",
  reason: string | null,
): SessionSnapshot {
  const existing = (snapshot.attendance[shiftId] ?? []).find(
    (row) => row.volunteerId === volunteerId,
  );
  if (existing && existing.status !== "expected") return snapshot;
  const next = withAttendance(snapshot, shiftId, {
    volunteerId,
    shiftId,
    role: existing?.role ?? registeredRole(shiftId, volunteerId),
    status: "checked_in",
    checkedInAt: workspace.now,
    checkedOutAt: null,
  });
  return persist({
    ...next,
    audit: [
      audit(
        action,
        "shift",
        shiftId,
        `Checked in ${volunteerName(volunteerId)}`,
        reason
          ? `Role: ${existing?.role ?? registeredRole(shiftId, volunteerId)}. Recorded by hand: ${reason}`
          : undefined,
      ),
      ...next.audit,
    ],
  });
}

function withAttendance(
  snapshot: SessionSnapshot,
  shiftId: string,
  entry: AttendanceEntry,
): SessionSnapshot {
  const existing = snapshot.attendance[shiftId] ?? [];
  return {
    ...snapshot,
    attendance: {
      ...snapshot.attendance,
      [shiftId]: [...existing.filter((row) => row.volunteerId !== entry.volunteerId), entry],
    },
  };
}

const REPORT_TITLES: Record<string, string> = {
  participation: "Volunteer participation",
  coverage: "Coverage by program",
  attendance: "Attendance and no-shows",
  retention: "Retention and engagement",
  skills: "Credentials and skills",
  credentials: "Credentials and skills",
  impact: "Community impact",
  custom: "Custom report",
};

const REPORT_FIELD_LABELS: Record<string, string> = {
  volunteer: "Volunteer",
  program: "Program",
  date: "Service date",
  hours: "Approved minutes",
  status: "Status",
  verification: "Verification",
  cause: "Cause",
  role: "Role",
};

function buildPreviewReport(request: ReportRequest): ReportDocument {
  const end = request.dateEnd ?? workspace.now.slice(0, 10);
  const start = request.dateStart ?? `${end.slice(0, 4)}-01-01`;
  const template = REPORT_TITLES[request.template] ? request.template : "custom";
  const cause = request.cause ?? "";
  const inRange = (date: string) => date >= start && date <= end;
  let headers: string[];
  let rows: string[][] = [];
  let summary: ReportSummaryItem[];

  if (template === "coverage") {
    headers = ["Date", "Program", "Role", "Required", "Filled", "Gap", "Shift status"];
    let required = 0;
    let filled = 0;
    for (const shift of workspace.shifts.filter((row) => row.startsAt >= workspace.now)) {
      const opportunity = workspace.opportunities.find((row) => row.id === shift.opportunityId);
      if (!opportunity || (cause && opportunity.cause !== cause)) continue;
      for (const role of shift.roles) {
        required += role.required;
        filled += role.filled;
        rows.push([
          shift.startsAt.slice(0, 10),
          opportunity.title,
          role.name,
          String(role.required),
          String(role.filled),
          String(Math.max(0, role.required - role.filled)),
          shift.status,
        ]);
      }
    }
    summary = [
      { label: "Required role slots", value: String(required) },
      { label: "Filled slots", value: String(filled) },
      {
        label: "Role coverage",
        value: `${required === 0 ? 100 : Math.round((filled / required) * 100)}%`,
      },
    ];
  } else if (template === "attendance") {
    headers = ["Date", "Program", "Volunteer", "Role", "Status", "Checked in", "Checked out"];
    let arrivals = 0;
    let completed = 0;
    let noShow = 0;
    for (const [shiftId, entries] of Object.entries(state.attendance)) {
      const shift = workspace.shifts.find((row) => row.id === shiftId);
      const opportunity = workspace.opportunities.find((row) => row.id === shift?.opportunityId);
      if (!shift || !opportunity || !inRange(shift.startsAt.slice(0, 10))) continue;
      if (cause && opportunity.cause !== cause) continue;
      for (const entry of entries) {
        const volunteer = workspace.volunteers.find((row) => row.id === entry.volunteerId);
        if (entry.status === "checked_in") arrivals += 1;
        if (entry.status === "completed") completed += 1;
        if (entry.status === "no_show") noShow += 1;
        rows.push([
          shift.startsAt.slice(0, 10),
          opportunity.title,
          volunteer?.name ?? "Volunteer",
          entry.role,
          entry.status,
          entry.checkedInAt ?? "",
          entry.checkedOutAt ?? "",
        ]);
      }
    }
    summary = [
      { label: "Arrivals", value: String(arrivals) },
      { label: "Completed", value: String(completed) },
      { label: "No-shows", value: String(noShow) },
    ];
  } else if (template === "retention") {
    headers = ["Cohort", "Eligible", "Returned in 30 days", "Rate"];
    rows = state.retention.map((row) => [
      row.label,
      String(row.eligible),
      String(row.returned),
      `${row.rate}%`,
    ]);
    const eligible = state.retention.reduce((sum, row) => sum + row.eligible, 0);
    const returned = state.retention.reduce((sum, row) => sum + row.returned, 0);
    summary = [
      { label: "Cohort eligible", value: String(eligible) },
      { label: "Returned", value: String(returned) },
      {
        label: "Average 30-day return",
        value: `${eligible === 0 ? 0 : Math.round((returned / eligible) * 100)}%`,
      },
    ];
  } else if (template === "skills" || template === "credentials") {
    headers = ["Volunteer", "Skill", "Credential", "Valid through", "Status"];
    let expiring = 0;
    for (const volunteer of workspace.volunteers) {
      for (const skill of volunteer.skills) {
        const credential = state.credentials.find((row) => row.volunteerId === volunteer.id);
        if (credential && credential.status !== "current") expiring += 1;
        rows.push([
          volunteer.name,
          skill,
          credential?.name ?? "—",
          credential?.validThrough ?? "—",
          credential?.status ?? "no credential",
        ]);
      }
    }
    summary = [
      { label: "Skill rows", value: String(rows.length) },
      { label: "Expiring or expired", value: String(expiring) },
    ];
  } else if (template === "impact") {
    headers = ["Program", "Metric", "Unit", "Value", "Recorded"];
    rows = state.impactMetrics.map((metric) => [
      workspace.opportunities.find((row) => row.id === metric.opportunityId)?.title ?? "Program",
      metric.name,
      metric.unit,
      String(metric.value),
      metric.recordedAt.slice(0, 10),
    ]);
    summary = [{ label: "Outcome records", value: String(rows.length) }];
  } else {
    const fields =
      request.fields.length > 0
        ? request.fields.filter((field) => field in REPORT_FIELD_LABELS)
        : ["volunteer", "program", "date", "hours", "status", "verification"];
    headers = fields.map((field) => REPORT_FIELD_LABELS[field]);
    let total = 0;
    let verified = 0;
    const volunteers = new Set<string>();
    for (const entry of [...workspace.hourEntries, ...workspace.mayaEntries]) {
      const opportunity = workspace.opportunities.find((row) => row.id === entry.opportunityId);
      const volunteer = workspace.volunteers.find((row) => row.id === entry.volunteerId);
      if (!opportunity || !volunteer || !inRange(entry.date)) continue;
      if (cause && opportunity.cause !== cause) continue;
      const decision = state.hoursDecisions[entry.id];
      const status = decision?.status ?? entry.status;
      const minutes = decision?.approvedMinutes ?? entry.minutes;
      total += minutes;
      if (status === "verified") {
        verified += minutes;
        volunteers.add(volunteer.id);
      }
      const registration = state.registrations.find(
        (row) => row.volunteerId === volunteer.id && row.status === "registered",
      );
      const values: Record<string, string> = {
        volunteer: volunteer.name,
        program: opportunity.title,
        date: entry.date,
        hours: String(minutes),
        status,
        verification: entry.verificationId ?? "",
        cause: opportunity.cause,
        role: registration?.role ?? "",
      };
      rows.push(fields.map((field) => values[field] ?? ""));
    }
    summary = [
      { label: "Records", value: String(rows.length) },
      { label: "Approved or recorded", value: `${Math.floor(total / 60)}h ${total % 60}m` },
      { label: "Verified", value: `${Math.floor(verified / 60)}h ${verified % 60}m` },
      { label: "Volunteers", value: String(volunteers.size) },
    ];
  }

  return {
    template,
    title: REPORT_TITLES[template],
    organization: state.settings.organizationName || workspace.organization.name,
    period: `${start} – ${end}`,
    generatedAt: workspace.now,
    headers,
    rows,
    summary,
  };
}

const IMPORTED_VOLUNTEERS_KEY = "civicflow.imported-volunteers.v1";

/** The heads the importer reads, mirroring the desktop column list. */
const IMPORT_COLUMNS: [string, string][] = [
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["status", "Status"],
  ["skills", "Skills"],
  ["availability", "Availability"],
  ["interests", "Interests"],
  ["causes", "Causes"],
];

const IMPORT_DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const IMPORT_PERIODS: PeriodKey[] = ["morning", "afternoon", "evening"];
const IMPORT_STATUSES = ["active", "onboarding", "inactive"];
const IMPORT_CAUSES: Cause[] = [
  "food",
  "education",
  "environment",
  "health",
  "community",
  "animals",
];
const IMPORT_EXAMPLE = [
  "Maya Chen",
  "maya.chen@example.org",
  "(716) 555-0142",
  "onboarding",
  "Food handling; Tutoring",
  "mon:morning; wed:evening",
  "Weekend pantry shifts, school tutoring",
  "food; education",
];

/** Splits a cell that holds several values, matching what the importer accepts. */
function splitCell(value: string, comma: boolean): string[] {
  return value
    .split(comma ? /[;|,]/ : /[;|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** A minimal RFC 4180 reader: quoted cells may hold commas and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const characters = [...text.replace(/^\ufeff/, "")];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '"') {
      if (quoted && characters[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && characters[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.trim().length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim().length > 0));
}

function importTemplate(): string {
  return `${csvText([IMPORT_COLUMNS.map(([, label]) => label), IMPORT_EXAMPLE])}\r\n`;
}

function importEmailProblem(raw: string): { email: string; problem: string } {
  const email = raw.trim().toLowerCase();
  const parts = email.split("@");
  const domain = parts[1] ?? "";
  const valid =
    parts.length === 2 &&
    (parts[0] ?? "").length > 0 &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !/\s/.test(email) &&
    email.length <= 160;
  return { email, problem: valid ? "" : "Use an email address like name@example.org." };
}

function readImportedRoster(): RosterVolunteer[] {
  try {
    const raw = localStorage.getItem(scoped(IMPORTED_VOLUNTEERS_KEY));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RosterVolunteer[]) : [];
  } catch {
    return [];
  }
}

function writeImportedRoster(records: RosterVolunteer[]): void {
  try {
    localStorage.setItem(scoped(IMPORTED_VOLUNTEERS_KEY), JSON.stringify(records));
  } catch {
    // Storage can be unavailable in hardened webviews; the session still works.
  }
}

function rosterRecord(volunteer: Volunteer): RosterVolunteer {
  return {
    id: volunteer.id,
    name: volunteer.name,
    email: volunteer.email,
    phone: volunteer.phone,
    status: volunteer.status,
    joinedAt: volunteer.joinedAt,
    skills: volunteer.skills,
    availability: volunteer.availability.map((slot) => `${slot.day}:${slot.period}`),
    causes: volunteer.causes,
  };
}

/**
 * What the roster holds: the seeded people plus the ones this device imported,
 * which is the same thing the desktop snapshot reports from SQLite.
 */
function workspaceRoster(): RosterVolunteer[] {
  const records = [...workspace.volunteers.map(rosterRecord), ...readImportedRoster()];
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

/**
 * The same check the desktop importer runs, so the browser preview refuses the
 * same files rather than accepting what SQLite would reject.
 */
function previewVolunteers(text: string): VolunteerImportPreview {
  const preview: VolunteerImportPreview = {
    columns: [],
    required: ["Name", "Email"],
    template: importTemplate(),
    total: 0,
    valid: 0,
    invalid: 0,
    problems: [],
    rows: [],
  };
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) {
    preview.problems.push("Choose a CSV file or paste its rows first.");
    return preview;
  }

  const indexes = new Map<string, number>();
  for (const [position, value] of header.entries()) {
    const cleaned = value.trim().toLowerCase();
    if (!cleaned) continue;
    preview.columns.push(value.trim());
    const column = IMPORT_COLUMNS.find(
      ([key, label]) => key === cleaned || label.toLowerCase() === cleaned,
    );
    if (column && !indexes.has(column[0])) indexes.set(column[0], position);
  }
  const missing = ["name", "email"].filter((key) => !indexes.has(key));
  if (missing.length > 0) {
    const labels = missing.map((key) => IMPORT_COLUMNS.find(([id]) => id === key)?.[1] ?? key);
    preview.problems.push(
      `The first row must name these columns: ${labels.join(", ")}. No rows were read.`,
    );
    return preview;
  }

  const read = (cells: string[], key: string) => {
    const position = indexes.get(key);
    return position === undefined ? "" : (cells[position] ?? "").trim();
  };
  const known = new Set(workspaceRoster().map((record) => record.email.toLowerCase()));
  const seen = new Set<string>();

  for (const [offset, cells] of rows.entries()) {
    const problems: string[] = [];
    const notes: string[] = [];
    const name = read(cells, "name").split(/\s+/).filter(Boolean).join(" ");
    if (name.length < 2) problems.push("Enter the name to show on this account.");
    if (name.length > 80) problems.push("Keep the name under 80 characters.");

    const { email, problem } = importEmailProblem(read(cells, "email"));
    if (problem) problems.push(problem);
    else if (seen.has(email)) problems.push(`Two rows use ${email}.`);
    else {
      seen.add(email);
      if (known.has(email)) problems.push(`${email} is already on this roster.`);
    }

    const statusCell = read(cells, "status").toLowerCase();
    let status = "onboarding";
    if (statusCell) {
      if (IMPORT_STATUSES.includes(statusCell)) status = statusCell;
      else problems.push(`"${statusCell}" is not a status. Use active, onboarding or inactive.`);
    }

    const skills = splitCell(read(cells, "skills"), false);
    if (skills.length === 0) notes.push("No skills listed yet.");

    const availability: string[] = [];
    for (const token of splitCell(read(cells, "availability"), false)) {
      const [day, period = ""] = token.toLowerCase().split(":");
      if (IMPORT_DAYS.includes(day as DayKey) && IMPORT_PERIODS.includes(period as PeriodKey)) {
        availability.push(`${day}:${period}`);
      } else {
        problems.push(`"${token}" needs a day and a period, like mon:morning.`);
      }
    }
    if (availability.length === 0 && !problems.some((entry) => entry.includes("mon:morning"))) {
      notes.push("No availability windows listed yet.");
    }

    const causes: string[] = [];
    for (const token of splitCell(read(cells, "causes"), true)) {
      const cause = token.toLowerCase();
      if (IMPORT_CAUSES.includes(cause as Cause)) causes.push(cause);
      else {
        problems.push(
          `"${cause}" is not a cause. Use food, education, environment, health, community or animals.`,
        );
      }
    }

    preview.rows.push({
      line: offset + 2,
      name,
      email,
      phone: read(cells, "phone"),
      status,
      skills,
      availability,
      interests: read(cells, "interests"),
      causes,
      outcome: problems.length === 0 ? "create" : "invalid",
      problems,
      notes,
    });
    preview.total += 1;
    if (problems.length === 0) preview.valid += 1;
    else preview.invalid += 1;
  }

  if (preview.total === 0) {
    preview.problems.push("The file has a header but no volunteer rows yet.");
  }
  return preview;
}

export const previewRepository: WorkspaceRepository = {
  source: "preview",
  async listOrganizations() {
    return previewOrganizations.list(requirePreviewAccount());
  },
  async listPublicOrganizations() {
    return previewOrganizations.listPublic();
  },
  async selectOrganization(organizationId) {
    if (!organizationId) {
      applyScope(null);
      return;
    }
    const access = previewOrganizations.select(requirePreviewAccount(), organizationId);
    applyScope({
      id: access.organization.id,
      name: access.organization.name,
      coordinatorName:
        access.membership.role === "owner" || access.membership.role === "coordinator"
          ? access.organization.name
          : undefined,
      image: access.organization.image ?? undefined,
      imageAlt: access.organization.imageAlt ?? undefined,
    });
  },
  async createOrganization(input) {
    const access = previewOrganizations.create(requirePreviewAccount(), input);
    applyScope({
      id: access.organization.id,
      name: access.organization.name,
      coordinatorName: access.organization.name,
      image: access.organization.image ?? undefined,
      imageAlt: access.organization.imageAlt ?? undefined,
    });
    return access;
  },
  async updateOrganization(organizationId, patch) {
    return previewOrganizations.update(requirePreviewAccount(), organizationId, patch);
  },
  async listOrganizationMembers(organizationId) {
    return previewOrganizations.members(requirePreviewAccount(), organizationId);
  },
  async listOrganizationInvites(organizationId) {
    return previewOrganizations.invites(requirePreviewAccount(), organizationId);
  },
  async createOrganizationInvite(organizationId, role, email) {
    return previewOrganizations.createInvite(requirePreviewAccount(), organizationId, role, email);
  },
  async revokeOrganizationInvite(organizationId, inviteId) {
    previewOrganizations.revokeInvite(requirePreviewAccount(), organizationId, inviteId);
  },
  async redeemOrganizationInvite(code) {
    const access = previewOrganizations.redeem(requirePreviewAccount(), code);
    applyScope({
      id: access.organization.id,
      name: access.organization.name,
      coordinatorName: access.organization.name,
      image: access.organization.image ?? undefined,
      imageAlt: access.organization.imageAlt ?? undefined,
    });
    return access;
  },
  async joinPublicOrganization(organizationId) {
    const access = previewOrganizations.join(requirePreviewAccount(), organizationId);
    applyScope({
      id: access.organization.id,
      name: access.organization.name,
      coordinatorName: access.organization.name,
      image: access.organization.image ?? undefined,
      imageAlt: access.organization.imageAlt ?? undefined,
    });
    return access;
  },
  async setOrganizationMemberRole(organizationId, userId, role) {
    return previewOrganizations.setRole(requirePreviewAccount(), organizationId, userId, role);
  },
  async setOrganizationMemberStatus(organizationId, userId, status) {
    return previewOrganizations.setStatus(requirePreviewAccount(), organizationId, userId, status);
  },
  async transferOrganizationOwnership(organizationId, userId) {
    return previewOrganizations.transferOwnership(requirePreviewAccount(), organizationId, userId);
  },
  async openDemoWorkspace(): Promise<AuthSession> {
    const demo = previewAccounts.find(
      (row) => row.email.toLowerCase() === "praket@rivergate.example",
    );
    if (!demo) throw new Error("The browser preview has no demo workspace to open.");
    const live = withLiveRole(demo);
    activePreviewAccount = live;
    return {
      token: previewToken(live),
      user: live,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  },
  async signIn(email, password, _remember): Promise<AuthSession> {
    const clean = email.trim().toLowerCase();
    const account = previewAccounts.find((row) => row.email.toLowerCase() === clean);
    const stored = account ? previewPasswords()[account.id] : undefined;
    const expected = stored ?? "civicflow-demo";
    if (!account || password !== expected) {
      throw new Error("That email and password do not match an account on this device.");
    }
    const live = withLiveRole(account);
    activePreviewAccount = live;
    return {
      token: previewToken(live),
      user: live,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  },
  async createAccount(name, email, password): Promise<AuthSession> {
    const clean = email.trim().toLowerCase();
    const display = name.trim().replace(/\s+/g, " ");
    if (display.length < 2) throw new Error("Enter the name to show on this account.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      throw new Error("Use an email address like name@example.org.");
    }
    if (password.length < 8) throw new Error("Use at least 8 characters for the password.");
    if (previewAccounts.some((row) => row.email.toLowerCase() === clean)) {
      throw new Error("An account already uses that email. Sign in instead.");
    }
    const suffix = Date.now().toString(36);
    const account: Account = {
      id: `user-preview-${suffix}`,
      name: display,
      email: clean,
      // A fresh identity has no workspace role. Membership supplies one.
      role: "none",
      volunteerId: null,
    };
    try {
      localStorage.setItem(
        PREVIEW_ACCOUNT_KEY,
        JSON.stringify({ ...previewPasswords(), [account.id]: password }),
      );
      localStorage.setItem(
        PREVIEW_ACCOUNTS_KEY,
        JSON.stringify([...storedPreviewAccounts(), account]),
      );
    } catch {
      throw new Error("The browser preview could not save the new account.");
    }
    previewAccounts.push(account);
    activePreviewAccount = account;
    return {
      token: previewToken(account),
      user: account,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  },
  async signInWithHosted({ name, email }): Promise<AuthSession> {
    const clean = email.trim().toLowerCase();
    const existing = previewAccounts.find((row) => row.email.toLowerCase() === clean);
    if (existing) {
      const live = withLiveRole(existing);
      activePreviewAccount = live;
      return {
        token: previewToken(live),
        user: live,
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      };
    }
    const suffix = Date.now().toString(36);
    const account: Account = {
      id: `user-hosted-${suffix}`,
      name: name.trim().replace(/\s+/g, " ") || clean,
      email: clean,
      role: "none",
      volunteerId: null,
    };
    try {
      localStorage.setItem(
        PREVIEW_ACCOUNTS_KEY,
        JSON.stringify([...storedPreviewAccounts(), account]),
      );
    } catch {
      throw new Error("The browser preview could not save the hosted account.");
    }
    previewAccounts.push(account);
    activePreviewAccount = account;
    return {
      token: previewToken(account),
      user: account,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
  },
  async signOut(token) {
    void token;
  },
  async currentUser(token) {
    const account = previewAccountFromToken(token);
    if (account) activePreviewAccount = account;
    return account;
  },
  async listAccounts(token) {
    const account = previewAccountFromToken(token);
    if (account?.role !== "coordinator") throw new Error("Only a coordinator can list accounts.");
    // This list answers "who is on this team", not "who exists on the device".
    const self = previewOrganizations.active(account);
    if (!self) return [];
    const roster = previewOrganizations.members(account, self.organization.id);
    const byId = new Map(previewAccounts.map((row) => [row.id, row]));
    return roster
      .map((member) => byId.get(member.userId))
      .filter((row): row is Account => Boolean(row))
      .map((row) => withLiveRole(row));
  },
  async resetPassword(token, userId, newPassword) {
    const account = previewAccountFromToken(token);
    if (account?.role !== "coordinator") throw new Error("Only a coordinator can reset passwords.");
    if (newPassword.length < 8) throw new Error("Use at least 8 characters for the password.");
    const target = previewAccounts.find((row) => row.id === userId);
    if (!target) throw new Error("Account not found.");
    try {
      localStorage.setItem(
        PREVIEW_ACCOUNT_KEY,
        JSON.stringify({ ...previewPasswords(), [userId]: newPassword }),
      );
    } catch {
      throw new Error("The browser preview could not save the new password.");
    }
  },
  async getSnapshot() {
    return state;
  },
  async setSaved(opportunityId, saved) {
    const opportunity = workspace.opportunities.find((row) => row.id === opportunityId);
    if (!opportunity) throw new Error("Opportunity not found");
    const currentlySaved = state.savedOpportunityIds.includes(opportunityId);
    if (currentlySaved === saved) return state;
    return persist({
      ...state,
      savedOpportunityIds: saved
        ? [...state.savedOpportunityIds, opportunityId]
        : state.savedOpportunityIds.filter((id) => id !== opportunityId),
      audit: [
        audit(
          saved ? "opportunity.save" : "opportunity.unsave",
          "opportunity",
          opportunityId,
          saved
            ? `Saved ${opportunity.title}`
            : `Removed ${opportunity.title} from saved opportunities`,
        ),
        ...state.audit,
      ],
    });
  },
  async setApplicationStage(applicationId, stage) {
    const applicant = state.applications.find((row) => row.id === applicationId);
    if (!applicant) throw new Error("Application not found");
    if (applicant.stage === stage) return state;
    return persist({
      ...state,
      applications: state.applications.map((row) =>
        row.id === applicationId ? { ...row, stage: stage as Applicant["stage"] } : row,
      ),
      audit: [
        audit(
          "application.stage",
          "volunteer",
          applicationId,
          `Moved ${applicant.name} to ${stage.charAt(0).toUpperCase()}${stage.slice(1)}`,
          `Previously ${applicant.stage}`,
        ),
        ...state.audit,
      ],
    });
  },
  async checkIn(shiftId, volunteerId, code) {
    const window = previewCheckinWindow(shiftId);
    if (!window.canSelfCheckIn) {
      throw new Error(
        window.status === "not_open"
          ? "Check-in opens 30 minutes before the shift starts."
          : "Self check-in closed 15 minutes after the shift started. Ask a coordinator to record your arrival.",
      );
    }
    const supplied = code.trim().replace(/^civicflow:\/\/checkin\//, "");
    const expected = previewCheckinCode(shiftId);
    // The door kiosk sends the QR payload; the volunteer page sends the digits.
    if (supplied !== expected && supplied !== `demo-${shiftId}-${expected}`) {
      throw new Error("That check-in code is not valid.");
    }
    return recordArrival(state, shiftId, volunteerId, "shift.checkin", null);
  },
  async manualCheckIn(shiftId, volunteerId, reason) {
    if (reason.trim().length < 4) {
      throw new Error("Say why this arrival is being recorded by hand.");
    }
    return recordArrival(state, shiftId, volunteerId, "shift.manual_checkin", reason.trim());
  },
  async checkOut(shiftId, volunteerId) {
    const existing = (state.attendance[shiftId] ?? []).find(
      (row) => row.volunteerId === volunteerId,
    );
    const next = withAttendance(state, shiftId, {
      volunteerId,
      shiftId,
      role: existing?.role ?? volunteerRole(volunteerId),
      status: "completed",
      checkedInAt: existing?.checkedInAt ?? workspace.now,
      checkedOutAt: workspace.now,
    });
    return persist({
      ...next,
      audit: [
        audit("shift.checkout", "shift", shiftId, `Checked out ${volunteerName(volunteerId)}`),
        ...next.audit,
      ],
    });
  },
  async cancelRegistration(shiftId, volunteerId, reason) {
    const registration = state.registrations.find(
      (row) => row.shiftId === shiftId && row.volunteerId === volunteerId,
    );
    if (!registration) throw new Error("That registration no longer exists.");
    const promoted = state.settings.autoPromoteWaitlist
      ? [...state.waitlist]
          .filter(
            (row) =>
              row.shiftId === shiftId &&
              row.status === "waiting" &&
              row.eligibleRole === registration.role,
          )
          .sort((a, b) => a.position - b.position)[0]
      : undefined;
    const nextRegistrations: SessionSnapshot["registrations"] = state.registrations.map((row) =>
      row.shiftId === shiftId && row.volunteerId === volunteerId
        ? { ...row, status: "canceled" }
        : row,
    );
    const auditEvents = [
      audit(
        "shift.cancel_registration",
        "shift",
        shiftId,
        `Canceled ${volunteerName(volunteerId)}'s registration`,
        reason,
      ),
    ];
    if (promoted) {
      nextRegistrations.push({
        shiftId,
        volunteerId: promoted.volunteerId,
        role: registration.role,
        status: "registered",
      });
      auditEvents.push(
        audit(
          "waitlist.promote",
          "shift",
          shiftId,
          `Promoted ${volunteerName(promoted.volunteerId)} from the waitlist`,
          `Filled the ${registration.role} seat opened by a cancellation`,
        ),
      );
    }
    return persist({
      ...state,
      registrations: nextRegistrations,
      waitlist: promoted
        ? state.waitlist.map((row) =>
            row.id === promoted.id ? { ...row, status: "promoted" } : row,
          )
        : state.waitlist,
      audit: [...auditEvents, ...state.audit],
    });
  },
  async joinWaitlist(shiftId, volunteerId, role) {
    if (
      state.waitlist.some(
        (row) =>
          row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "waiting",
      )
    ) {
      return state;
    }
    const entry: WaitlistEntry = {
      id: `wait-${Date.now()}`,
      shiftId,
      volunteerId,
      createdAt: workspace.now,
      status: "waiting",
      position:
        state.waitlist.filter((row) => row.shiftId === shiftId && row.status === "waiting").length +
        1,
      eligibleRole: role,
    };
    return persist({
      ...state,
      waitlist: [...state.waitlist, entry],
      audit: [
        audit(
          "waitlist.join",
          "shift",
          shiftId,
          `Added ${volunteerName(volunteerId)} to the waitlist`,
        ),
        ...state.audit,
      ],
    });
  },
  async checkinWindow(shiftId): Promise<CheckinWindow> {
    return previewCheckinWindow(shiftId);
  },
  async installationAccess(): Promise<InstallationAccess> {
    return { steward: previewOrganizations.isWorkspaceSteward(requirePreviewAccount()) };
  },
  async getCheckinCode(shiftId): Promise<CheckinCode> {
    const issuedAt = workspace.now;
    const expiresAt = new Date(
      new Date(workspace.now).getTime() + 4 * 60 * 60 * 1000,
    ).toISOString();
    const code = previewCheckinCode(shiftId);
    const token = `demo-${shiftId}-${code}`;
    return {
      shiftId,
      code,
      token,
      issuedAt,
      expiresAt,
      payload: `civicflow://checkin/${token}`,
    };
  },
  async autoRoster(shiftIds, options): Promise<RosterPlan> {
    return previewRosterPlan(shiftIds, options, readRosterPolicy());
  },
  async evaluateRoster(shiftIds, options): Promise<RosterEvaluation> {
    return previewEvaluation(shiftIds, options);
  },
  async applyRosterWeek(expectedRevision, expectedPolicyVersion, assignments) {
    if (assignments.length === 0) {
      throw new Error("Select at least one suggested assignment to apply");
    }
    if (expectedRevision !== null && expectedRevision !== revision) {
      throw new Error(
        "PLAN_STALE: the roster changed after this plan was generated. Rebuild the plan so nobody is double-booked.",
      );
    }
    if (expectedPolicyVersion !== null && expectedPolicyVersion !== readRosterPolicy().version) {
      throw new Error(
        "POLICY_STALE: the matching policy changed after this plan was generated. Rebuild the plan before applying it.",
      );
    }
    let next = state;
    const events: AuditEvent[] = [];
    for (const assignment of assignments) {
      if (assignment.promoteWaitlist) {
        next = {
          ...next,
          waitlist: next.waitlist.map((row) =>
            row.shiftId === assignment.shiftId &&
            row.volunteerId === assignment.candidateId &&
            row.status === "waiting"
              ? { ...row, status: "promoted" }
              : row,
          ),
        };
      }
      next = {
        ...next,
        registrations: [
          ...next.registrations.filter(
            (row) =>
              !(row.shiftId === assignment.shiftId && row.volunteerId === assignment.candidateId),
          ),
          {
            shiftId: assignment.shiftId,
            volunteerId: assignment.candidateId,
            role: assignment.role,
            status: "registered",
          },
        ],
      };
      events.push(
        audit(
          assignment.promoteWaitlist ? "waitlist.promote" : "autoroster.apply",
          "shift",
          assignment.shiftId,
          `AutoRoster assigned ${volunteerName(assignment.candidateId)} as ${assignment.role}`,
          "Applied from an approved AutoRoster plan",
        ),
      );
    }
    return persist({ ...next, audit: [...events, ...next.audit] });
  },
  async getRosterPolicy(): Promise<RosterPolicyView> {
    return {
      policy: readRosterPolicy(),
      levels: PREVIEW_PRIORITY_LEVELS,
      organizationId: scopeId(),
    };
  },
  async updateRosterPolicy(policy): Promise<RosterPolicyView> {
    validateRosterPolicy(policy);
    const next: RosterPolicy = { ...policy, version: readRosterPolicy().version + 1 };
    writeRosterPolicy(next);
    return { policy: next, levels: PREVIEW_PRIORITY_LEVELS, organizationId: scopeId() };
  },
  async explainRosterChoice(shiftIds, options, candidateId, slotId): Promise<CandidateAnswer> {
    return previewExplain(shiftIds, options, candidateId, slotId);
  },
  async applyRoster(shiftId, assignments: RosterApplyAssignment[]) {
    if (assignments.length === 0) {
      throw new Error("Select at least one suggested assignment to apply");
    }
    let next = state;
    const events: AuditEvent[] = [];
    for (const assignment of assignments) {
      if (assignment.promoteWaitlist) {
        next = {
          ...next,
          waitlist: next.waitlist.map((row) =>
            row.shiftId === shiftId &&
            row.volunteerId === assignment.candidateId &&
            row.status === "waiting"
              ? { ...row, status: "promoted" }
              : row,
          ),
        };
      }
      next = {
        ...next,
        registrations: [
          ...next.registrations.filter(
            (row) => !(row.shiftId === shiftId && row.volunteerId === assignment.candidateId),
          ),
          {
            shiftId,
            volunteerId: assignment.candidateId,
            role: assignment.role,
            status: "registered",
          },
        ],
      };
      events.push(
        audit(
          assignment.promoteWaitlist ? "waitlist.promote" : "autoroster.apply",
          "shift",
          shiftId,
          `AutoRoster assigned ${volunteerName(assignment.candidateId)} as ${assignment.role}`,
          "Applied from an approved AutoRoster plan",
        ),
      );
    }
    return persist({ ...next, audit: [...events, ...next.audit] });
  },
  async detectDisruptions(): Promise<DisruptionReport> {
    return previewDisruptions();
  },
  async planRecovery(shiftIds, options): Promise<RecoveryPlan> {
    return previewRecoveryPlan(shiftIds, options);
  },
  async applyRecovery(shiftId, changes: RecoveryChangeRequest[]) {
    if (changes.length === 0) throw new Error("Select at least one change to apply");
    const shift = workspace.shifts.find((row) => row.id === shiftId);
    if (!shift || shift.status !== "scheduled") {
      throw new Error("This shift is no longer accepting assignments.");
    }
    let next = state;
    const events: AuditEvent[] = [];
    for (const change of changes) {
      const held = next.registrations.find(
        (row) => row.shiftId === shiftId && row.volunteerId === change.volunteerId,
      );
      if (change.fromRole) {
        if (!held || held.status !== "registered" || held.role !== change.fromRole) {
          throw new Error("That volunteer is no longer on this shift, so there is nothing to move");
        }
        if (previewLocks.has(`${shiftId}:${change.volunteerId}`)) {
          throw new Error("That assignment is locked. Unlock it first.");
        }
      }
      next = {
        ...next,
        waitlist: change.promoteWaitlist
          ? next.waitlist.map((row) =>
              row.shiftId === shiftId &&
              row.volunteerId === change.volunteerId &&
              row.status === "waiting"
                ? { ...row, status: "promoted" }
                : row,
            )
          : next.waitlist,
        registrations: [
          ...next.registrations.filter(
            (row) => !(row.shiftId === shiftId && row.volunteerId === change.volunteerId),
          ),
          { shiftId, volunteerId: change.volunteerId, role: change.role, status: "registered" },
        ],
      };
      events.push(
        audit(
          "recovery.apply",
          "shift",
          shiftId,
          change.fromRole
            ? `Recovery moved ${volunteerName(change.volunteerId)} from ${change.fromRole} to ${change.role}`
            : `Recovery assigned ${volunteerName(change.volunteerId)} as ${change.role}`,
          "Approved from a coverage recovery plan",
        ),
      );
    }
    return persist({ ...next, audit: [...events, ...next.audit] });
  },
  async setAssignmentLock(shiftId, volunteerId, locked) {
    const held = state.registrations.find(
      (row) => row.shiftId === shiftId && row.volunteerId === volunteerId,
    );
    if (!held || held.status !== "registered") {
      throw new Error("Only a live assignment can be locked");
    }
    const key = `${shiftId}:${volunteerId}`;
    if (previewLocks.has(key) === locked) return state;
    if (locked) previewLocks.add(key);
    else previewLocks.delete(key);
    return persist({
      ...state,
      audit: [
        audit(
          locked ? "assignment.lock" : "assignment.unlock",
          "shift",
          shiftId,
          `${locked ? "Locked" : "Unlocked"} ${volunteerName(volunteerId)}'s assignment`,
          locked
            ? "Recovery and AutoRoster will not move a locked assignment"
            : "The assignment can be replanned again",
        ),
        ...state.audit,
      ],
    });
  },
  async createShiftSeries(opportunityId, rule, roles): Promise<SeriesResult> {
    const opportunity = [...workspace.opportunities, ...state.createdOpportunities].find(
      (row) => row.id === opportunityId,
    );
    if (!opportunity) throw new Error("That program is not on file.");
    if (roles.length === 0) throw new Error("Give the series at least one role to fill");
    const needed = roles.reduce((total, role) => total + role.required, 0);
    if (needed > opportunity.capacity) {
      throw new Error(
        `These roles need ${needed} volunteers, but ${opportunity.title} is listed for ${opportunity.capacity}`,
      );
    }
    const dates = previewOccurrences(rule);
    const series: ShiftSeriesRecord = {
      id: `series-${Date.now().toString(36)}`,
      opportunityId,
      opportunityTitle: opportunity.title,
      timezone: workspace.organization.timezone,
      kind: rule.kind,
      intervalWeeks: rule.intervalWeeks,
      weekdays: rule.weekdays,
      startsLocalTime: rule.startsLocalTime,
      durationMinutes: rule.durationMinutes,
      startsOn: rule.startsOn,
      endsOn: rule.endsOn,
      occurrenceCount: rule.occurrenceCount,
      generated: dates.length,
      roles,
    };
    const shifts = dates.map((date, index) => {
      const startsAt = previewShiftStart(date, rule.startsLocalTime);
      return {
        id: `sh-series-${series.id}-${index + 1}`,
        occurrenceDate: date,
        startsAt,
        endsAt: new Date(
          new Date(startsAt).getTime() + rule.durationMinutes * 60_000,
        ).toISOString(),
      };
    });
    const next = persist({
      ...state,
      createdSeries: [...(state.createdSeries ?? []), series],
      createdShifts: [...(state.createdShifts ?? []), ...shifts],
      audit: [
        audit(
          "series.create",
          "opportunity",
          opportunityId,
          `Scheduled ${shifts.length} shift(s) for ${opportunity.title}`,
          `${series.kind === "weekly" ? "Weekly" : "Single"} series, ${roles.length} roles`,
        ),
        ...state.audit,
      ],
    });
    return { series, shifts, snapshot: next };
  },
  async listShiftSeries(opportunityId): Promise<ShiftSeriesRecord[]> {
    const series = state.createdSeries ?? [];
    return opportunityId ? series.filter((row) => row.opportunityId === opportunityId) : series;
  },
  async generateSeriesInstances(seriesId): Promise<SeriesResult> {
    const series = (state.createdSeries ?? []).find((row) => row.id === seriesId);
    if (!series) throw new Error("That series is not on file.");
    const existing = new Set(
      (state.createdShifts ?? [])
        .filter((row) => row.id.startsWith(`sh-series-${seriesId}-`))
        .map((row) => row.occurrenceDate),
    );
    const dates = previewOccurrences(previewRuleOf(series)).filter((date) => !existing.has(date));
    const added = dates.map((date, index) => {
      const startsAt = previewShiftStart(date, series.startsLocalTime);
      return {
        id: `sh-series-${seriesId}-extra-${index + 1}-${date}`,
        occurrenceDate: date,
        startsAt,
        endsAt: new Date(
          new Date(startsAt).getTime() + series.durationMinutes * 60_000,
        ).toISOString(),
      };
    });
    const next = persist({
      ...state,
      createdShifts: [...(state.createdShifts ?? []), ...added],
      createdSeries: (state.createdSeries ?? []).map((row) =>
        row.id === seriesId ? { ...row, generated: row.generated + added.length } : row,
      ),
    });
    return {
      series: next.createdSeries?.find((row) => row.id === seriesId) ?? series,
      shifts: added,
      snapshot: next,
    };
  },
  async retimeShiftSeries(seriesId, startsLocalTime, durationMinutes, scope) {
    const series = (state.createdSeries ?? []).find((row) => row.id === seriesId);
    if (!series) throw new Error("That series is not on file.");
    const today = workspace.now.slice(0, 10);
    let moved = 0;
    const shifts = (state.createdShifts ?? []).map((row) => {
      const mine = row.id.startsWith(`sh-series-${seriesId}-`);
      if (!mine || row.occurrenceDate < today) return row;
      if (scope === "instance" && moved > 0) return row;
      moved += 1;
      const startsAt = previewShiftStart(row.occurrenceDate, startsLocalTime);
      return {
        ...row,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString(),
      };
    });
    const next = persist({
      ...state,
      createdShifts: shifts,
      createdSeries: (state.createdSeries ?? []).map((row) =>
        row.id === seriesId
          ? {
              ...row,
              startsLocalTime: scope === "series" ? startsLocalTime : row.startsLocalTime,
              durationMinutes: scope === "series" ? durationMinutes : row.durationMinutes,
            }
          : row,
      ),
      audit: [
        audit(
          "series.retime",
          "opportunity",
          series.opportunityId,
          `Moved ${moved} shift(s) to ${startsLocalTime}`,
          scope === "instance" ? "Applied to this shift only" : "Applied to the whole series",
        ),
        ...state.audit,
      ],
    });
    return next;
  },
  async deleteShiftSeries(seriesId) {
    const series = (state.createdSeries ?? []).find((row) => row.id === seriesId);
    if (!series) throw new Error("That series is not on file.");
    const booked = (state.createdShifts ?? []).some(
      (row) =>
        row.id.startsWith(`sh-series-${seriesId}-`) &&
        state.registrations.some(
          (registration) => registration.shiftId === row.id && registration.status === "registered",
        ),
    );
    if (booked) {
      throw new Error(
        "Some of these shifts already have volunteers. Remove them first, or cancel the series from the schedule.",
      );
    }
    return persist({
      ...state,
      createdShifts: (state.createdShifts ?? []).filter(
        (row) => !row.id.startsWith(`sh-series-${seriesId}-`),
      ),
      createdSeries: (state.createdSeries ?? []).filter((row) => row.id !== seriesId),
      audit: [
        audit(
          "series.delete",
          "opportunity",
          series.opportunityId,
          `Removed ${series.generated} shift(s) from ${series.opportunityTitle}`,
          "The series and its shifts were deleted together",
        ),
        ...state.audit,
      ],
    });
  },
  async recommendReplacement(shiftId, role): Promise<ReplacementRecommendation> {
    return previewReplacement(shiftId, role);
  },
  async listNotificationRules(): Promise<NotificationRule[]> {
    return previewRules();
  },
  async updateNotificationRule(ruleId, patch: NotificationRulePatch) {
    const rules = previewRules().map((rule) =>
      rule.id === ruleId
        ? {
            ...rule,
            offsetMinutes: patch.offsetMinutes ?? rule.offsetMinutes,
            enabled: patch.enabled ?? rule.enabled,
          }
        : rule,
    );
    writePreviewRules(rules);
    return rules;
  },
  async queueDueReminders(): Promise<number> {
    return previewReminders().length;
  },
  async retentionSignals(): Promise<RetentionSignal[]> {
    return previewSignals();
  },
  async volunteerInsight(volunteerId): Promise<VolunteerInsight> {
    return previewInsight(volunteerId);
  },
  async engagementMetrics(): Promise<EngagementMetrics> {
    return previewEngagement();
  },
  async credentialReadiness(): Promise<CredentialReadiness> {
    return previewReadiness();
  },
  async markNoShow(shiftId, volunteerId) {
    const existing = (state.attendance[shiftId] ?? []).find(
      (row) => row.volunteerId === volunteerId,
    );
    // Marking the same person twice must not release the seat twice, and must
    // not write a second audit entry for one absence.
    if (existing?.status === "no_show") return state;
    if (existing?.status === "checked_in" || existing?.status === "completed") {
      throw new Error(
        "This volunteer already checked in. Correct the attendance record instead of marking a no-show.",
      );
    }
    const registration = state.registrations.find(
      (row) =>
        row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "registered",
    );
    if (!registration) {
      throw new Error("That volunteer does not hold a seat on this shift.");
    }
    const next = withAttendance(state, shiftId, {
      volunteerId,
      shiftId,
      role: existing?.role ?? registration.role ?? volunteerRole(volunteerId),
      status: "no_show",
      checkedInAt: null,
      checkedOutAt: null,
    });
    return persist({
      ...next,
      // Seat and role totals are projections of the registration rows, so the
      // absence has to land there too or every count keeps the empty seat.
      registrations: next.registrations.map((row) =>
        row.shiftId === shiftId && row.volunteerId === volunteerId && row.status === "registered"
          ? { ...row, status: "no_show" }
          : row,
      ),
      audit: [
        audit(
          "shift.no_show",
          "shift",
          shiftId,
          `Marked ${volunteerName(volunteerId)} as a no-show`,
        ),
        ...next.audit,
      ],
    });
  },
  async promoteWaitlist(shiftId, volunteerId) {
    const entry = state.waitlist.find(
      (row) => row.shiftId === shiftId && row.volunteerId === volunteerId,
    );
    if (!entry) throw new Error("Waitlist entry not found");
    if (entry.status !== "waiting") return state;
    return persist({
      ...state,
      waitlist: state.waitlist.map((row) =>
        row.id === entry.id ? { ...row, status: "promoted" } : row,
      ),
      registrations: [
        ...state.registrations.filter(
          (row) => !(row.shiftId === shiftId && row.volunteerId === volunteerId),
        ),
        { shiftId, volunteerId, role: volunteerRole(volunteerId), status: "registered" },
      ],
      audit: [
        audit(
          "waitlist.promote",
          "shift",
          shiftId,
          `Promoted ${volunteerName(volunteerId)} from the waitlist`,
        ),
        ...state.audit,
      ],
    });
  },
  async reviewHours(entryId, decision: HoursDecision) {
    const entry = [...workspace.hourEntries, ...workspace.mayaEntries].find(
      (row) => row.id === entryId,
    );
    if (!entry || entry.status !== "pending") throw new Error("Only pending hours can be reviewed");
    if (decision.status === "verified" && !decision.approvedMinutes) {
      throw new Error("Approved hours need an approved minute value");
    }
    return persist({
      ...state,
      hoursDecisions: { ...state.hoursDecisions, [entryId]: decision },
      audit: [
        audit(
          decision.status === "verified" ? "hours.approve" : "hours.reject",
          "hours",
          entryId,
          decision.status === "verified"
            ? `Approved ${decision.approvedMinutes ?? 0} minutes for ${volunteerName(entry.volunteerId)}`
            : `Rejected submitted hours for ${volunteerName(entry.volunteerId)}`,
          decision.reason,
        ),
        ...state.audit,
      ],
    });
  },
  async updateSettings(patch) {
    const settings = { ...state.settings, ...patch };
    if (!settings.organizationName.trim()) throw new Error("Organization name is required");
    if (!settings.contactEmail.includes("@")) throw new Error("Enter a valid contact email");
    return persist({
      ...state,
      settings,
      audit: [
        audit("settings.update", "settings", "workspace", "Updated workspace settings"),
        ...state.audit,
      ],
    });
  },
  async createOpportunity(input: NewOpportunityInput) {
    const id = `opp-new-${Date.now()}`;
    const opportunity: Opportunity = {
      id,
      slug: input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
      title: input.title,
      cause: input.cause,
      organization: workspace.organization.name,
      image: "/media/opp-community-event.jpg",
      imageAlt: `${input.title} volunteers at work`,
      description: input.description,
      address: input.address,
      distanceMiles: 2.4,
      coordinator: workspace.coordinator.name,
      capacity: input.capacity,
      duration: input.duration,
      training: ["Orientation on arrival"],
      requirements: input.requirements,
      impactMetric: "New program — impact will be tracked after the first shift",
    };
    return {
      opportunity,
      snapshot: persist({
        ...state,
        createdOpportunities: [opportunity, ...state.createdOpportunities],
        audit: [
          audit(
            "opportunity.create",
            "opportunity",
            opportunity.id,
            `Created ${opportunity.title}`,
            `Capacity: ${opportunity.capacity}`,
          ),
          ...state.audit,
        ],
      }),
    };
  },
  async registerForShift(shiftId, volunteerId, role) {
    return persist({
      ...state,
      registrations: [
        ...state.registrations.filter(
          (row) => !(row.shiftId === shiftId && row.volunteerId === volunteerId),
        ),
        {
          shiftId,
          volunteerId,
          role: role.trim() || volunteerRole(volunteerId),
          status: "registered",
        },
      ],
      audit: [
        audit(
          "shift.register",
          "shift",
          shiftId,
          `Registered ${volunteerName(volunteerId)} as ${role || volunteerRole(volunteerId)}`,
        ),
        ...state.audit,
      ],
    });
  },
  async saveVolunteerProfile(patch) {
    if (patch.skills && patch.skills.length === 0) {
      throw new Error("Choose at least one skill so matches stay explainable");
    }
    if (patch.availability && patch.availability.length === 0) {
      throw new Error("Add at least one availability window");
    }
    return persist({
      ...state,
      volunteerProfile: { ...state.volunteerProfile, ...patch },
      audit: [
        audit(
          "volunteer.profile_update",
          "volunteer",
          workspace.currentVolunteerId,
          "Updated skills and availability",
        ),
        ...state.audit,
      ],
    });
  },
  async previewVolunteerImport(text: string) {
    return previewVolunteers(text);
  },
  async applyVolunteerImport(text: string) {
    const preview = previewVolunteers(text);
    if (preview.problems.length > 0) throw new Error(preview.problems.join(" "));
    if (preview.invalid > 0) {
      throw new Error(
        `${preview.invalid} of ${preview.total} rows need a fix before anything is written.`,
      );
    }
    if (preview.valid === 0) throw new Error("This file has no volunteer rows to add.");

    const created: RosterVolunteer[] = preview.rows.map((row, index) => ({
      id: `vol-new-${Date.now()}-${index}`,
      name: row.name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      joinedAt: workspace.now,
      skills: row.skills,
      availability: row.availability,
      causes: row.causes,
    }));
    writeImportedRoster([...readImportedRoster(), ...created]);
    // Adding them to the loaded workspace means this session's roster screens and
    // candidate pools see the same people the stored roster does.
    workspace = withRoster(workspace, created);
    state = persist({
      ...state,
      audit: [
        audit(
          "volunteers.imported",
          "volunteer",
          created[0]?.id ?? "roster",
          `Imported ${created.length} volunteer${created.length === 1 ? "" : "s"} from a spreadsheet`,
          `${preview.total} rows read · ${created.length} added`,
        ),
        ...state.audit,
      ],
    });
    return { created: created.length, createdIds: created.map((row) => row.id), preview };
  },
  async exportVolunteerRoster() {
    const header = IMPORT_COLUMNS.map(([, label]) => label);
    const rows = workspaceRoster().map((record) => [
      record.name,
      record.email,
      record.phone,
      record.status,
      record.skills.join("; "),
      record.availability.join("; "),
      "",
      record.causes.join("; "),
    ]);
    const blob = downloadCsv("civicflow-volunteer-roster.csv", [header, ...rows]);
    return {
      path: "browser-download",
      bytes: blob.size,
      format: "csv" as const,
      title: "Volunteer roster",
    };
  },
  async resetDemo() {
    try {
      localStorage.removeItem(scoped(STORAGE_KEY));
      localStorage.removeItem(scoped(READ_KEY));
    } catch {
      // Resetting in memory is still meaningful.
    }
    state = createDefaultSnapshot();
    return state;
  },
  async listBackups() {
    return listBackupMeta();
  },
  async createBackup(note) {
    const backups = ensureBackups();
    const created = makeBackup(state, "manual", note?.trim() || "Manual snapshot");
    writeBackups([created, ...backups]);
    return listBackupMeta();
  },
  async exportEncryptedBackup() {
    throw new Error("Encrypted archives are written by the desktop app.");
  },
  async importEncryptedBackup() {
    throw new Error("Encrypted archives are opened by the desktop app.");
  },
  async restoreBackup(id): Promise<BackupRestoreResult> {
    const backups = ensureBackups();
    const target = backups.find((entry) => entry.meta.id === id);
    if (!target) throw new Error("That snapshot is not available in this workspace.");
    if (!validSnapshot(target.snapshot)) {
      throw new Error("That backup is incomplete or foreign and was not restored.");
    }

    const safety = makeBackup(state, "automatic", `Before restoring ${id}`);
    writeBackups([safety, ...backups]);

    const restored = clone(target.snapshot);
    const event = audit(
      "backup.restore",
      "backup",
      id,
      `Restored backup ${id}`,
      `Safety snapshot: ${safety.meta.id}`,
    );
    const next = persist({ ...restored, audit: [event, ...restored.audit] });
    return { snapshot: next, backups: listBackupMeta() };
  },
  async getMissionControl(role: "coordinator" | "volunteer" = "coordinator") {
    return buildMissionControl(countedWorkspace(), readIds(), role);
  },
  async getNotifications(role: AccountRole) {
    const read = readIds();
    return workspace.notifications
      .filter((notification) =>
        role === "volunteer"
          ? notification.href.startsWith("/volunteer")
          : !notification.href.startsWith("/volunteer"),
      )
      .map((notification) => ({
        ...notification,
        readAt: read.includes(notification.id) ? new Date().toISOString() : notification.readAt,
      }));
  },
  async markNotificationRead(id: string, _role: AccountRole) {
    writeIds([...readIds(), id]);
  },
  async saveReportView(name, scope, filtersJson) {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      throw new Error("Saved view names must be 2–80 characters.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(filtersJson);
    } catch {
      throw new Error("Saved view filters must be valid JSON.");
    }
    if (!isRecord(parsed)) throw new Error("Saved view filters must be a JSON object.");
    const existing = state.savedViews.find((view) => view.name === trimmed && view.scope === scope);
    const savedView: SavedViewRecord = {
      id: existing?.id ?? `view-${Date.now()}`,
      scope,
      name: trimmed,
      filtersJson,
      createdAt: existing?.createdAt ?? workspace.now,
    };
    return persist({
      ...state,
      savedViews: existing
        ? state.savedViews.map((view) => (view.id === existing.id ? savedView : view))
        : [savedView, ...state.savedViews],
      audit: [
        audit("report.view_saved", "system", trimmed, `Saved report view ${trimmed}`),
        ...state.audit,
      ],
    });
  },
  async generateReport(request) {
    return buildPreviewReport(request);
  },
  async exportReport(request, format) {
    const report = buildPreviewReport(request);
    if (format === "csv") {
      const blob = downloadCsv(`civicflow-${report.template}-${report.period.slice(0, 10)}.csv`, [
        report.headers,
        ...report.rows,
      ]);
      return {
        path: "browser-download",
        bytes: blob.size,
        format,
        title: report.title,
      };
    }
    const printWindow = window.open("", "_blank", "width=960,height=1000");
    if (!printWindow) throw new Error("Allow pop-ups to open the printable report.");
    printWindow.document.write(
      `<!doctype html><title>${report.title}</title><style>body{font:12px system-ui;padding:32px;color:#111}h1{font-size:20px}h2{font-size:14px;font-weight:500}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:10px}th{background:#f2f2f2}</style>` +
        `<h1>${report.organization}</h1><h2>${report.title} · ${report.period}</h2>` +
        `<p>${report.summary.map((item) => `${item.label}: ${item.value}`).join(" · ")}</p>` +
        `<table><thead><tr>${report.headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${report.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
    );
    printWindow.document.close();
    printWindow.focus();
    printWindow.setTimeout(() => printWindow.print(), 250);
    return { path: "print-dialog", bytes: 0, format, title: report.title };
  },
};

/* ---------------------------------------------------------------------------
 * The preview's matching rules: the same policy, checks and weights in
 * miniature. One seat at a time, best scoring eligible volunteer.
 * ------------------------------------------------------------------------- */

const PREVIEW_PRIORITY_LEVELS: PriorityLevel[] = [
  { key: "none", weight: 0 },
  { key: "low", weight: 5 },
  { key: "medium", weight: 10 },
  { key: "high", weight: 15 },
  { key: "top", weight: 35 },
];

const POLICY_KEY = "civicflow.roster-policy.v1";

function defaultRosterPolicy(): RosterPolicy {
  return {
    version: 1,
    maxShiftsPerDay: null,
    maxMinutesPerDay: null,
    maxShiftsPerWeek: null,
    maxMinutesPerWeek: null,
    minimumGapMinutes: 0,
    unknownAgeBehavior: "block",
    unknownCredentialBehavior: "block",
    skillWeight: 35,
    interestWeight: 15,
    languageWeight: 10,
    fairnessWeight: 10,
    reliabilityWeight: 5,
    waitlistPreference: false,
  };
}

function readRosterPolicy(): RosterPolicy {
  try {
    const raw = localStorage.getItem(scoped(POLICY_KEY));
    if (!raw) return defaultRosterPolicy();
    const parsed = JSON.parse(raw) as Partial<RosterPolicy>;
    return { ...defaultRosterPolicy(), ...parsed };
  } catch {
    return defaultRosterPolicy();
  }
}

function writeRosterPolicy(policy: RosterPolicy): void {
  try {
    localStorage.setItem(scoped(POLICY_KEY), JSON.stringify(policy));
  } catch {
    // Storage can be unavailable in hardened webviews; the run still works.
  }
}

function validateRosterPolicy(policy: RosterPolicy): void {
  const limits: [string, number | null, number, number][] = [
    ["Maximum shifts a day", policy.maxShiftsPerDay, 1, 12],
    ["Maximum shifts a week", policy.maxShiftsPerWeek, 1, 40],
    ["Maximum minutes a day", policy.maxMinutesPerDay, 15, 1_440],
    ["Maximum minutes a week", policy.maxMinutesPerWeek, 60, 10_080],
  ];
  for (const [label, value, low, high] of limits) {
    if (value !== null && (value < low || value > high)) {
      throw new Error(`${label} must be between ${low} and ${high}.`);
    }
  }
  if (policy.minimumGapMinutes < 0 || policy.minimumGapMinutes > 1_440) {
    throw new Error("Keep the minimum time between shifts under 24 hours.");
  }
  const weights = [
    policy.skillWeight,
    policy.interestWeight,
    policy.languageWeight,
    policy.fairnessWeight,
    policy.reliabilityWeight,
  ];
  if (weights.some((weight) => !PREVIEW_PRIORITY_LEVELS.some((level) => level.weight === weight))) {
    throw new Error("Choose one of the offered match priorities.");
  }
  if (weights.reduce((total, weight) => total + weight, 0) > 100) {
    throw new Error("Those priorities add up past a perfect match. Lower one of them.");
  }
}

interface PreviewSeat {
  slotId: string;
  shiftId: string;
  opportunityId: string;
  shiftTitle: string;
  role: string;
  cause: string;
  startsAt: string;
  endsAt: string;
  dayKey: string;
  requiredSkill: string;
  requiredCredential: string | null;
}

interface PreviewBlock {
  start: number;
  end: number;
}

interface PreviewLoad {
  blocks: Map<string, PreviewBlock[]>;
  dayCount: Map<string, number>;
  weekCount: Map<string, number>;
}

interface PreviewChoice {
  seat: PreviewSeat;
  volunteer: Volunteer;
  checks: ConstraintCheck[];
  components: ScoreComponent[];
  score: number;
}

interface PreviewPlanShape {
  choices: PreviewChoice[];
  unfilled: { seat: PreviewSeat; reason: string }[];
  beforeSeat: Map<string, PreviewLoad>;
}

function previewDayKey(startsAt: string): string {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(startsAt).getDay()];
}

function previewPeriod(startsAt: string): string {
  const hour = new Date(startsAt).getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/// Coordinator locks are a property of a live assignment. The preview keeps them
// for the session; the desktop stores them on the registration row.
const previewLocks = new Set<string>();

const RULE_KEY = "civicflow.notification-rules.v1";

const PREVIEW_RULES: NotificationRule[] = [
  {
    id: "rule-shift_reminder-volunteer",
    triggerType: "shift_reminder",
    offsetMinutes: 1440,
    audience: "volunteer",
    enabled: true,
  },
  {
    id: "rule-checkin_soon-volunteer",
    triggerType: "checkin_soon",
    offsetMinutes: 120,
    audience: "volunteer",
    enabled: true,
  },
  {
    id: "rule-missed_shift_follow_up-coordinator",
    triggerType: "missed_shift_follow_up",
    offsetMinutes: 60,
    audience: "coordinator",
    enabled: true,
  },
  {
    id: "rule-credential_expiring-coordinator",
    triggerType: "credential_expiring",
    offsetMinutes: 43200,
    audience: "coordinator",
    enabled: true,
  },
];

function previewRules(): NotificationRule[] {
  try {
    const raw = localStorage.getItem(scoped(RULE_KEY));
    if (!raw) return PREVIEW_RULES;
    const stored = JSON.parse(raw) as NotificationRule[];
    return PREVIEW_RULES.map((rule) => stored.find((row) => row.id === rule.id) ?? rule);
  } catch {
    return PREVIEW_RULES;
  }
}

function writePreviewRules(rules: NotificationRule[]): void {
  try {
    localStorage.setItem(scoped(RULE_KEY), JSON.stringify(rules));
  } catch {
    // The in-memory rules are enough when storage is refused.
  }
}

/** Every date the rule produces. The Rust engine is authoritative; this is the
// same arithmetic over the preview's clock. */
function previewOccurrences(rule: RecurrenceRule): string[] {
  const startsOn = rule.startsOn;
  if (!startsOn) throw new Error("Choose the date the series starts");
  if (rule.durationMinutes < 15 || rule.durationMinutes > 1440) {
    throw new Error("A shift has to last between 15 minutes and 24 hours");
  }
  if (rule.kind === "none") return [startsOn];
  if (rule.weekdays.length === 0) throw new Error("Choose at least one weekday to repeat on");
  if (rule.endsOn && rule.occurrenceCount) {
    throw new Error("Choose either an end date or an occurrence count, not both");
  }
  if (!rule.endsOn && !rule.occurrenceCount) {
    throw new Error("Give the series an end date or an occurrence count");
  }
  const interval = Math.min(Math.max(rule.intervalWeeks, 1), 8);
  const [year, month, day] = startsOn.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());
  const dates: string[] = [];
  for (let week = 0; week < 260; week += 1) {
    for (const weekday of [...rule.weekdays].sort((a, b) => a - b)) {
      const date = new Date(anchor);
      date.setUTCDate(anchor.getUTCDate() + week * 7 * interval + weekday);
      const key = date.toISOString().slice(0, 10);
      if (key < startsOn) continue;
      if (rule.endsOn && key > rule.endsOn) continue;
      if (!dates.includes(key)) dates.push(key);
    }
    dates.sort();
    if (rule.occurrenceCount && dates.length >= rule.occurrenceCount) break;
    if (rule.endsOn) {
      const limit = new Date(anchor);
      limit.setUTCDate(anchor.getUTCDate() + (week + 1) * 7 * interval);
      if (limit.toISOString().slice(0, 10) > rule.endsOn) break;
    }
  }
  const capped = rule.occurrenceCount ? dates.slice(0, rule.occurrenceCount) : dates;
  if (capped.length === 0) throw new Error("That rule produces no shifts");
  if (capped.length > 60) {
    throw new Error(
      `That rule would create ${capped.length} shifts. Shorten the series to 60 or fewer.`,
    );
  }
  return capped;
}

function previewShiftStart(date: string, startsLocalTime: string): string {
  const [hours, minutes] = startsLocalTime.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours + 4, minutes)).toISOString();
}

function previewRuleOf(series: ShiftSeriesRecord): RecurrenceRule {
  return {
    kind: series.kind,
    intervalWeeks: series.intervalWeeks,
    weekdays: series.weekdays,
    startsLocalTime: series.startsLocalTime,
    durationMinutes: series.durationMinutes,
    startsOn: series.startsOn,
    endsOn: series.endsOn,
    occurrenceCount: series.occurrenceCount,
  };
}

function previewLiveRegistrations(snapshot: SessionSnapshot, shiftId: string) {
  return snapshot.registrations.filter(
    (row) => row.shiftId === shiftId && row.status === "registered",
  );
}

function previewDisruptions(): DisruptionReport {
  const now = workspace.now;
  const shifts: DisruptedShift[] = [];
  const atRisk: DisruptionReport["atRisk"] = [];

  for (const shift of workspace.shifts.filter((row) => row.endsAt > now)) {
    const live = previewLiveRegistrations(state, shift.id);
    const title =
      workspace.opportunities.find((row) => row.id === shift.opportunityId)?.title ?? "Shift";
    const roles: DisruptedRole[] = shift.roles
      .map((role) => {
        const filled = live.filter((row) => row.role === role.name).length;
        return {
          role: role.name,
          required: role.required,
          filled,
          open: Math.max(0, role.required - filled),
        };
      })
      .filter((role) => role.open > 0);

    if (roles.length > 0) {
      shifts.push({
        shiftId: shift.id,
        opportunityId: shift.opportunityId,
        title,
        startsAt: shift.startsAt,
        capacity: shift.capacity,
        confirmed: live.length,
        roles,
        reasons: roles.map(
          (role) =>
            `${role.open} required ${role.open === 1 ? "seat" : "seats"} open as ${role.role}`,
        ),
      });
    }

    for (const row of live) {
      const lapsed = state.credentials.find(
        (credential) =>
          credential.volunteerId === row.volunteerId && credential.status === "expired",
      );
      if (!lapsed) continue;
      atRisk.push({
        shiftId: shift.id,
        shiftTitle: title,
        startsAt: shift.startsAt,
        volunteerId: row.volunteerId,
        volunteerName: volunteerName(row.volunteerId),
        role: row.role,
        credential: lapsed.name,
        validThrough: lapsed.validThrough,
        expired: true,
      });
    }
  }

  return {
    now,
    openRequired: shifts.reduce(
      (total, shift) => total + shift.roles.reduce((sum, role) => sum + role.open, 0),
      0,
    ),
    shifts,
    atRisk,
  };
}

function previewRecoveryPlan(shiftIds: string[], options: RosterOptions): RecoveryPlan {
  if (shiftIds.length === 0) throw new Error("Choose at least one shift to recover");
  const policy = readRosterPolicy();
  const report = previewDisruptions();
  const chosen = previewRosterPlan(shiftIds, options, policy);

  const changes: RecoveryChange[] = chosen.assignments.map((assignment) => {
    const waiting = state.waitlist.some(
      (row) =>
        row.shiftId === assignment.shiftId &&
        row.volunteerId === assignment.candidateId &&
        row.status === "waiting",
    );
    return {
      kind: waiting ? "promote" : "assign",
      shiftId: assignment.shiftId,
      shiftTitle: assignment.shiftTitle,
      startsAt: assignment.startsAt,
      role: assignment.role,
      fromRole: null,
      volunteerId: assignment.candidateId,
      volunteerName: assignment.candidateName,
      volunteerInitials: assignment.candidateInitials,
      score: assignment.score,
      cost: 0,
      reason: `${waiting ? "Promoted from the waitlist: " : ""}${assignment.reasons[0] ?? "Eligible and available"}`,
    };
  });
  const remaining: RecoverySeat[] = chosen.unfilled.map((slot) => ({
    shiftId: slot.shiftId,
    role: slot.role,
    reason: slot.reason,
  }));

  return {
    shifts: report.shifts.filter((shift) => shiftIds.includes(shift.shiftId)),
    changes,
    remaining,
    openBefore: changes.length + remaining.length,
    openAfter: remaining.length,
    movedAssignments: 0,
    policyVersion: policy.version,
  };
}

/** The demeed date a preview shift stands for, so a signal can count days. */
function previewDaysSince(stamp: string): number {
  const then = new Date(stamp).getTime();
  const now = new Date(workspace.now).getTime();
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

function previewCompletedShifts(volunteerId: string): string[] {
  const now = workspace.now;
  return workspace.shifts
    .filter(
      (shift) =>
        shift.endsAt < now &&
        state.registrations.some(
          (row) =>
            row.shiftId === shift.id &&
            row.volunteerId === volunteerId &&
            row.status === "registered",
        ),
    )
    .map((shift) => shift.id);
}

/** The same transparent rules the Rust engine applies, over preview rows. */
function previewSignals(): RetentionSignal[] {
  const signals: RetentionSignal[] = [];
  for (const volunteer of workspace.volunteers) {
    if (volunteer.status !== "active") continue;
    const completed = previewCompletedShifts(volunteer.id);
    const last = [...(state.attendance ? Object.values(state.attendance).flat() : [])]
      .filter((row) => row.volunteerId === volunteer.id)
      .sort((a, b) => (a.checkedInAt ?? "").localeCompare(b.checkedInAt ?? ""))
      .at(-1);
    const idle = last?.checkedInAt ? previewDaysSince(last.checkedInAt) : Number.MAX_SAFE_INTEGER;

    if (idle >= 90 && completed.length > 0) {
      signals.push({
        volunteerId: volunteer.id,
        name: volunteer.name,
        initials: volunteer.initials,
        signal: "inactive",
        reason: `No completed shift in ${idle} days, but ${completed.length} on record`,
        history: [`${completed.length} completed shift(s)`],
        suggestedAction: "Send upcoming opportunities from their usual program",
      });
      continue;
    }

    const registered = state.registrations.filter((row) => row.volunteerId === volunteer.id);
    const lost = registered.filter((row) => row.status === "canceled").length;
    if (completed.length === 0 && registered.length >= 1 && lost >= 2) {
      signals.push({
        volunteerId: volunteer.id,
        name: volunteer.name,
        initials: volunteer.initials,
        signal: "newVolunteerAtRisk",
        reason: `${lost} registration(s) ended in a cancellation and no shift has been completed`,
        history: [`${registered.length} registration(s) in total`],
        suggestedAction:
          "Offer a shorter or better-supported first shift, or a call from the coordinator",
      });
      continue;
    }

    const recent = completed.filter((shiftId) => {
      const shift = workspace.shifts.find((row) => row.id === shiftId);
      return shift ? previewDaysSince(shift.endsAt) <= 60 : false;
    });
    if (recent.length >= 4) {
      signals.push({
        volunteerId: volunteer.id,
        name: volunteer.name,
        initials: volunteer.initials,
        signal: "highlyEngaged",
        reason: `${recent.length} completed shifts in the last 60 days`,
        history: [`${completed.length} completed shifts in total`],
        suggestedAction: "Ask them to mentor a new volunteer or lead a shift",
      });
      continue;
    }

    const lapsed = state.credentials.filter(
      (credential) => credential.volunteerId === volunteer.id && credential.status === "expired",
    );
    if (lapsed.length > 0) {
      signals.push({
        volunteerId: volunteer.id,
        name: volunteer.name,
        initials: volunteer.initials,
        signal: "credentialBlocker",
        reason: `An expired ${lapsed.map((row) => row.name).join(", ")} blocks the roles that need it`,
        history: [],
        suggestedAction: "Send the renewal steps and hold a seat for the next shift",
      });
    }
  }
  return signals;
}

function previewInsight(volunteerId: string): VolunteerInsight {
  const volunteer = workspace.volunteers.find((row) => row.id === volunteerId);
  if (!volunteer) throw new Error("That volunteer is not on file.");
  const verifiedMinutes = [...workspace.hourEntries, ...workspace.mayaEntries]
    .filter((entry) => entry.volunteerId === volunteerId && entry.status === "verified")
    .reduce((total, entry) => total + entry.minutes, 0);
  const verifiedHours = Math.floor(verifiedMinutes / 60);
  const completed = previewCompletedShifts(volunteerId).length;
  const daysOfService = previewDaysSince(volunteer.joinedAt);

  const milestones: Milestone[] = [
    ...[10, 25, 50].map((hours) => ({
      key: `hours-${hours}`,
      label: `${hours} verified hours`,
      earned: verifiedHours >= hours,
      remaining: `${Math.max(0, hours - verifiedHours)} hour(s) to go`,
    })),
    {
      key: "shifts-10",
      label: "10 completed shifts",
      earned: completed >= 10,
      remaining: `${Math.max(0, 10 - completed)} shift(s) to go`,
    },
    {
      key: "service-year-1",
      label: "One year of service",
      earned: daysOfService >= 365,
      remaining: `${Math.max(0, 365 - daysOfService)} day(s) to go`,
    },
  ];
  const next = milestones.find((milestone) => !milestone.earned);
  return {
    volunteerId,
    name: volunteer.name,
    verifiedHours,
    completedShifts: completed,
    milestones,
    next: next ? `${next.label} — ${next.remaining}` : null,
  };
}

function previewEngagement(): EngagementMetrics {
  const yearStart = workspace.now.slice(0, 4);
  const newVolunteers = workspace.volunteers.filter((volunteer) =>
    volunteer.joinedAt.startsWith(yearStart),
  ).length;
  const inactiveVolunteers = previewSignals().filter(
    (signal) => signal.signal === "inactive",
  ).length;
  const completedShifts = workspace.shifts.filter((shift) => shift.endsAt < workspace.now).length;
  const attendanceRows = Object.values(state.attendance ?? {}).flat();
  const arrivals = attendanceRows.filter((row) => row.status === "checked_in").length;
  const noShows = attendanceRows.filter((row) => row.status === "no_show").length;
  const cancellations = state.registrations.filter((row) => row.status === "canceled").length;
  const promotions = state.waitlist.filter((row) => row.status === "promoted").length;
  const share = (part: number, whole: number) =>
    whole <= 0 ? 0 : Math.round((part / whole) * 100);
  return {
    newVolunteers,
    return30: share(state.retention[0]?.returned ?? 0, state.retention[0]?.eligible ?? 1),
    return60: share(state.retention[1]?.returned ?? 0, state.retention[1]?.eligible ?? 1),
    return90: share(state.retention[2]?.returned ?? 0, state.retention[2]?.eligible ?? 1),
    inactiveVolunteers,
    completedShifts,
    noShowRate: share(noShows, arrivals + noShows),
    lateCancellationRate: share(cancellations, state.registrations.length),
    averageLeadDays: 9,
    waitlistPromotions: promotions,
    waitlistPromotionRate: share(promotions, state.waitlist.length),
  };
}

function previewReadiness(): CredentialReadiness {
  const today = workspace.now.slice(0, 10);
  const current = state.credentials.filter((row) => row.status === "current").length;
  const expiringSoon = state.credentials.filter((row) => row.status === "expiring").length;
  const expired = state.credentials.filter((row) => row.status === "expired").length;
  const atRisk = state.registrations.filter((registration) => {
    if (registration.status !== "registered") return false;
    const shift = workspace.shifts.find((row) => row.id === registration.shiftId);
    if (!shift || shift.startsAt <= workspace.now) return false;
    return state.credentials.some(
      (credential) =>
        credential.volunteerId === registration.volunteerId &&
        credential.validThrough < today &&
        credential.status === "expired",
    );
  }).length;
  return { current, expiringSoon, expired, assignmentsAtRisk: atRisk };
}

function previewReplacement(shiftId: string, role: string): ReplacementRecommendation {
  const shift = workspace.shifts.find((row) => row.id === shiftId);
  const title =
    workspace.opportunities.find((row) => row.id === shift?.opportunityId)?.title ?? "Shift";
  if (!shift) throw new Error("That shift is not on file.");

  const ranked: WaitlistCandidate[] = state.waitlist
    .filter((row) => row.shiftId === shiftId && row.status === "waiting")
    .sort((a, b) => a.position - b.position)
    .map((entry) => {
      const volunteer = workspace.volunteers.find((row) => row.id === entry.volunteerId);
      const lapsed = state.credentials.find(
        (credential) =>
          credential.volunteerId === entry.volunteerId && credential.status === "expired",
      );
      return {
        volunteerId: entry.volunteerId,
        name: volunteer?.name ?? "Volunteer",
        initials: volunteer?.initials ?? "",
        position: entry.position,
        eligible: !lapsed,
        reason: lapsed
          ? `This role needs a valid ${lapsed.name} on the shift date.`
          : "Meets every requirement for this role.",
        attendanceRate: volunteer?.attendanceRate ?? 0,
        joinedAt: entry.createdAt,
      };
    });
  const recommended = ranked.find((row) => row.eligible) ?? null;
  const skipped = ranked.filter(
    (row) => !row.eligible && row.position < (recommended?.position ?? Infinity),
  );
  const summary = recommended
    ? skipped.length === 0
      ? `${recommended.name} was first in line on the waitlist and meets every requirement for ${role}.`
      : `${recommended.name} was first eligible on the waitlist. ${skipped.length} ahead in line could not take the seat: ${skipped
          .map((row) => `${row.name} (${row.reason})`)
          .join("; ")}.`
    : ranked.length === 0
      ? `Nobody is waiting for ${role} on ${title}.`
      : `None of the ${ranked.length} waiting volunteers can take ${role} right now: ${ranked
          .map((row) => `${row.name} (${row.reason})`)
          .join("; ")}.`;

  return {
    shiftId,
    shiftTitle: title,
    role,
    startsAt: shift.startsAt,
    recommended,
    ranked,
    summary,
  };
}

/** Reminders the preview would queue, from the same triggers the engine uses. */
function previewReminders(): string[] {
  const rules = previewRules().filter((rule) => rule.enabled);
  const due: string[] = [];
  for (const rule of rules) {
    if (rule.triggerType === "credential_expiring") {
      due.push(
        ...state.credentials
          .filter((row) => row.status === "expiring")
          .map((row) => `${rule.id}:${row.id}`),
      );
      continue;
    }
    if (rule.triggerType === "shift_reminder" || rule.triggerType === "checkin_soon") {
      const horizon = new Date(
        new Date(workspace.now).getTime() + rule.offsetMinutes * 60_000 + 30 * 60_000,
      ).toISOString();
      due.push(
        ...state.registrations
          .filter((row) => {
            if (row.status !== "registered") return false;
            const shift = workspace.shifts.find((entry) => entry.id === row.shiftId);
            return Boolean(shift && shift.startsAt > workspace.now && shift.startsAt <= horizon);
          })
          .map((row) => `${rule.id}:${row.shiftId}:${row.volunteerId}`),
      );
    }
  }
  return due;
}

/**
 * The skill and credential a role demands, by the same name rules the Rust
 * core applies when it seeds requirements. The browser has to agree with the
 * desktop here, otherwise the preview would show a different shortlist than
 * the optimizer actually used.
 */
function previewRoleRequirement(role: string): { skill: string; credential: string | null } {
  const lower = role.toLowerCase();
  if (lower.includes("spanish")) return { skill: "Spanish", credential: null };
  if (lower.includes("driver") || lower.includes("delivery")) {
    return { skill: "Driver", credential: "Safe driver clearance" };
  }
  if (lower.includes("tutor")) return { skill: "Tutoring", credential: "Tutor certification" };
  if (lower.includes("food") || lower.includes("pantry") || lower.includes("sort")) {
    return { skill: "Food handling", credential: "Food safety handler" };
  }
  if (lower.includes("garden") || lower.includes("tool")) {
    return { skill: "Gardening", credential: "Garden tool safety" };
  }
  return { skill: "", credential: null };
}

function previewSeats(shiftIds: string[]): PreviewSeat[] {
  const seats: PreviewSeat[] = [];
  for (const shift of workspace.shifts.filter((row) => shiftIds.includes(row.id))) {
    const opportunity = workspace.opportunities.find((row) => row.id === shift.opportunityId);
    const live = state.registrations.filter(
      (row) => row.shiftId === shift.id && row.status === "registered",
    );
    for (const role of shift.roles) {
      const requirement = previewRoleRequirement(role.name);
      const filled = live.filter((row) => row.role === role.name).length;
      for (let seat = 0; seat < Math.max(0, role.required - filled); seat += 1) {
        seats.push({
          slotId: `${shift.id}-${role.name}-${seat + 1}`,
          shiftId: shift.id,
          opportunityId: shift.opportunityId,
          shiftTitle: opportunity?.title ?? "Shift",
          role: role.name,
          cause: opportunity?.cause ?? "food",
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          dayKey: previewDayKey(shift.startsAt),
          requiredSkill: requirement.skill,
          requiredCredential: requirement.credential,
        });
      }
    }
  }
  return seats;
}

function emptyLoad(): PreviewLoad {
  return { blocks: new Map(), dayCount: new Map(), weekCount: new Map() };
}

function cloneLoad(load: PreviewLoad): PreviewLoad {
  return {
    blocks: new Map(
      [...load.blocks].map(([volunteerId, blocks]) => [
        volunteerId,
        blocks.map((block) => ({ ...block })),
      ]),
    ),
    dayCount: new Map(load.dayCount),
    weekCount: new Map(load.weekCount),
  };
}

/**
 * Everything the roster already holds: blocks for overlap checks, plus the
 * day and week counts the limits read. Building it once keeps the plan and the
 * candidate browser on the same starting point.
 */
function previewBaseLoad(): PreviewLoad {
  const load = emptyLoad();
  const now = new Date(workspace.now).getTime();
  const horizon = now + 7 * 86_400_000;
  for (const registration of state.registrations) {
    if (registration.status !== "registered") continue;
    const shift = workspace.shifts.find((row) => row.id === registration.shiftId);
    if (!shift) continue;
    const start = new Date(shift.startsAt).getTime();
    const blocks = load.blocks.get(registration.volunteerId) ?? [];
    blocks.push({ start, end: new Date(shift.endsAt).getTime() });
    load.blocks.set(registration.volunteerId, blocks);
    if (start < now || start > horizon) continue;
    const day = previewDayKey(shift.startsAt);
    const dayKey = `${registration.volunteerId}:${day}`;
    load.dayCount.set(dayKey, (load.dayCount.get(dayKey) ?? 0) + 1);
    load.weekCount.set(
      registration.volunteerId,
      (load.weekCount.get(registration.volunteerId) ?? 0) + 1,
    );
  }
  return load;
}

function previewAvailability(volunteer: Volunteer, seat: PreviewSeat): boolean {
  if (volunteer.availability.length === 0) return true;
  const period = previewPeriod(seat.startsAt);
  return volunteer.availability.some((slot) => slot.day === seat.dayKey && slot.period === period);
}

function previewChecks(
  volunteer: Volunteer,
  seat: PreviewSeat,
  options: RosterOptions,
  policy: RosterPolicy,
  load: PreviewLoad,
): ConstraintCheck[] {
  const checks: ConstraintCheck[] = [];
  const registered = state.registrations.some(
    (row) =>
      row.shiftId === seat.shiftId &&
      row.volunteerId === volunteer.id &&
      row.status === "registered",
  );
  checks.push({
    name: "Already on this shift",
    passed: !registered,
    detail: registered
      ? "This volunteer is already registered for the shift"
      : "Not registered yet",
  });
  if (seat.requiredSkill) {
    const skillMatch = volunteer.skills.some((skill) =>
      skill.toLowerCase().includes(seat.requiredSkill.toLowerCase()),
    );
    checks.push({
      name: "Required skill",
      passed: skillMatch,
      detail: skillMatch ? `${seat.requiredSkill} on the profile` : `Needs ${seat.requiredSkill}`,
    });
  }

  if (seat.requiredCredential) {
    const on = seat.startsAt.slice(0, 10);
    const held = state.credentials.filter(
      (row) =>
        row.volunteerId === volunteer.id &&
        row.name.toLowerCase() === seat.requiredCredential!.toLowerCase(),
    );
    const current = held.some((row) => row.validThrough.slice(0, 10) >= on);
    const expired = !current && held.length > 0;
    checks.push({
      name: "Required credential",
      passed: current,
      detail: current
        ? `${seat.requiredCredential} current`
        : expired
          ? `${seat.requiredCredential} expired`
          : `No ${seat.requiredCredential} on record`,
    });
  }

  const available = previewAvailability(volunteer, seat);
  checks.push({
    name: "Availability",
    passed: available,
    detail: available
      ? `Available ${seat.dayKey.toUpperCase()} ${previewPeriod(seat.startsAt)}`
      : `Not available ${seat.dayKey.toUpperCase()} ${previewPeriod(seat.startsAt)}`,
  });

  if (options.blockConflicts) {
    const start = new Date(seat.startsAt).getTime();
    const end = new Date(seat.endsAt).getTime();
    const clash = (load.blocks.get(volunteer.id) ?? []).some(
      (block) => block.start < end && block.end > start,
    );
    checks.push({
      name: "No overlapping shift",
      passed: !clash,
      detail: clash ? "Already booked at this time" : "No shift overlaps this time",
    });
  }

  const dayTaken = (load.dayCount.get(`${volunteer.id}:${seat.dayKey}`) ?? 0) + 1;
  if (policy.maxShiftsPerDay !== null) {
    checks.push({
      name: "Daily shift limit",
      passed: dayTaken <= policy.maxShiftsPerDay,
      detail: `${dayTaken} of ${policy.maxShiftsPerDay} that day`,
    });
  }

  const weekTaken = (load.weekCount.get(volunteer.id) ?? 0) + 1;
  const weekLimit = policy.maxShiftsPerWeek ?? (options.capWeekly ? 2 : null);
  if (weekLimit !== null) {
    checks.push({
      name: "Weekly shift limit",
      passed: weekTaken <= weekLimit,
      detail: `${weekTaken} of ${weekLimit} this week`,
    });
  }
  return checks;
}

function previewShare(weight: number, numerator: number, denominator: number): number {
  return Math.floor((weight * numerator) / denominator);
}

function previewScore(
  volunteer: Volunteer,
  seat: PreviewSeat,
  options: RosterOptions,
  policy: RosterPolicy,
  load: PreviewLoad,
): { components: ScoreComponent[]; total: number } {
  const skillMatches =
    !seat.requiredSkill ||
    volunteer.skills.some((skill) =>
      skill.toLowerCase().includes(seat.requiredSkill.toLowerCase()),
    );
  // A role with no requirement fits anyone eligible, slightly less precisely
  // than a matched requirement, which is how the solver scores it too.
  const skill = seat.requiredSkill
    ? skillMatches
      ? policy.skillWeight
      : 0
    : previewShare(policy.skillWeight, 6, 7);
  const availability = 25;
  const interest = volunteer.causes.includes(seat.cause as Volunteer["causes"][number])
    ? policy.interestWeight
    : 0;
  const spanish = volunteer.languages.includes("Spanish");
  const preference =
    seat.role.toLowerCase().includes("spanish") && spanish
      ? policy.languageWeight
      : options.preferSpanish && spanish
        ? previewShare(policy.languageWeight, 8, 10)
        : previewShare(policy.languageWeight, 6, 10);
  const weekShifts = load.weekCount.get(volunteer.id) ?? 0;
  const fairness = previewShare(policy.fairnessWeight, 10 - Math.min(weekShifts, 4) * 2, 10);
  const reliability =
    volunteer.eventsCompleted === 0
      ? previewShare(policy.reliabilityWeight, 3, 5)
      : Math.round((volunteer.attendanceRate / 100) * policy.reliabilityWeight);
  const components: ScoreComponent[] = [
    { label: "Skill", awarded: skill, maximum: policy.skillWeight },
    { label: "Availability", awarded: availability, maximum: 25 },
    { label: "Interest", awarded: interest, maximum: policy.interestWeight },
    { label: "Language", awarded: preference, maximum: policy.languageWeight },
    { label: "Fairness", awarded: fairness, maximum: policy.fairnessWeight },
    { label: "Reliability", awarded: reliability, maximum: policy.reliabilityWeight },
  ];
  const total = Math.max(
    0,
    Math.min(
      100,
      components.reduce((sum, component) => sum + component.awarded, 0),
    ),
  );
  return { components, total };
}

const PREVIEW_MAX_WEIGHT = 100;

function previewBreakdown(components: ScoreComponent[]) {
  const value = (label: string) =>
    components.find((component) => component.label === label)?.awarded ?? 0;
  return {
    skill: value("Skill"),
    availability: value("Availability"),
    interest: value("Interest"),
    preference: value("Language"),
    fairness: value("Fairness"),
    reliability: value("Reliability"),
    total: Math.max(
      0,
      Math.min(
        PREVIEW_MAX_WEIGHT,
        components.reduce((sum, row) => sum + row.awarded, 0),
      ),
    ),
  };
}

function previewReason(choice: PreviewChoice): string {
  const parts: string[] = [
    choice.seat.requiredSkill
      ? `matches the required ${choice.seat.requiredSkill} skill`
      : "needs no special skill",
  ];
  if (choice.volunteer.causes.includes(choice.seat.cause as Volunteer["causes"][number])) {
    parts.push(`is interested in ${choice.seat.cause}`);
  }
  if (choice.volunteer.attendanceRate >= 80) {
    parts.push(`has ${choice.volunteer.attendanceRate}% attendance`);
  }
  return `${choice.volunteer.name} ${parts.join(", ")}`;
}

/**
 * One pass over open seats. `forced` pins a volunteer, as the Rust planner does.
 */
function previewPlanShape(
  shiftIds: string[],
  options: RosterOptions,
  policy: RosterPolicy,
  forced?: { candidateId: string; slotId: string },
): PreviewPlanShape {
  const seats = previewSeats(shiftIds);
  const pool = workspace.volunteers.filter((volunteer) => volunteer.status === "active");
  const load = previewBaseLoad();
  const choices: PreviewChoice[] = [];
  const unfilled: { seat: PreviewSeat; reason: string }[] = [];
  const beforeSeat = new Map<string, PreviewLoad>();

  for (const seat of seats) {
    beforeSeat.set(seat.slotId, cloneLoad(load));
    const isForcedSeat = forced?.slotId === seat.slotId;
    const considered = isForcedSeat
      ? pool.filter((volunteer) => volunteer.id === forced?.candidateId)
      : pool.filter((volunteer) => volunteer.id !== forced?.candidateId);

    let best: PreviewChoice | null = null;
    for (const volunteer of considered) {
      const checks = previewChecks(volunteer, seat, options, policy, load);
      if (checks.some((check) => !check.passed)) continue;
      const { components, total } = previewScore(volunteer, seat, options, policy, load);
      if (!best || total > best.score) {
        best = { seat, volunteer, checks, components, score: total };
      }
    }

    if (!best) {
      unfilled.push({
        seat,
        reason: isForcedSeat
          ? "The chosen volunteer does not clear the current rules for this seat."
          : "No eligible volunteer is available for this slot.",
      });
      continue;
    }

    choices.push(best);
    const blocks = load.blocks.get(best.volunteer.id) ?? [];
    blocks.push({
      start: new Date(seat.startsAt).getTime(),
      end: new Date(seat.endsAt).getTime(),
    });
    load.blocks.set(best.volunteer.id, blocks);
    load.dayCount.set(
      `${best.volunteer.id}:${seat.dayKey}`,
      (load.dayCount.get(`${best.volunteer.id}:${seat.dayKey}`) ?? 0) + 1,
    );
    load.weekCount.set(best.volunteer.id, (load.weekCount.get(best.volunteer.id) ?? 0) + 1);
  }

  return { choices, unfilled, beforeSeat };
}

function previewExplanation(
  volunteer: Volunteer,
  seat: PreviewSeat,
  options: RosterOptions,
  policy: RosterPolicy,
  load: PreviewLoad,
  selected: boolean,
): MatchExplanation {
  const checks = previewChecks(volunteer, seat, options, policy, load);
  const eligible = checks.every((check) => check.passed);
  const { components, total } = previewScore(volunteer, seat, options, policy, load);
  const choice: PreviewChoice = { seat, volunteer, checks, components, score: total };
  return {
    candidateId: volunteer.id,
    candidateName: volunteer.name,
    candidateInitials: volunteer.initials,
    slotId: seat.slotId,
    shiftId: seat.shiftId,
    role: seat.role,
    eligible,
    checks,
    components,
    totalScore: eligible ? total : null,
    selected,
    selectionReason: eligible
      ? previewReason(choice)
      : `${volunteer.name} failed one requirement — ${
          checks.find((check) => !check.passed)?.name.toLowerCase() ?? "eligibility"
        }`,
  };
}

function previewRequiredFilled(shape: PreviewPlanShape): number {
  return shape.choices.length;
}

function previewComparison(
  before: PreviewPlanShape,
  after: PreviewPlanShape,
  volunteer: Volunteer,
  seat: PreviewSeat,
): ForcedComparison {
  const beforeBySlot = new Map(before.choices.map((choice) => [choice.seat.slotId, choice]));
  const afterBySlot = new Map(after.choices.map((choice) => [choice.seat.slotId, choice]));
  const changedAssignments: ForcedComparison["changedAssignments"] = [];
  const becomesUncovered: string[] = [];

  for (const [slotId, choice] of beforeBySlot) {
    const now = afterBySlot.get(slotId);
    if (now?.volunteer.id === choice.volunteer.id) continue;
    if (!now) becomesUncovered.push(`${choice.seat.role} on ${choice.seat.shiftTitle}`);
    changedAssignments.push({
      kind: now ? "moved" : "lost",
      shiftId: choice.seat.shiftId,
      shiftTitle: choice.seat.shiftTitle,
      role: choice.seat.role,
      fromCandidate: choice.volunteer.id,
      toCandidate: now?.volunteer.id ?? null,
    });
  }
  for (const [slotId, choice] of afterBySlot) {
    if (beforeBySlot.has(slotId)) continue;
    changedAssignments.push({
      kind: "gained",
      shiftId: choice.seat.shiftId,
      shiftTitle: choice.seat.shiftTitle,
      role: choice.seat.role,
      fromCandidate: null,
      toCandidate: choice.volunteer.id,
    });
  }

  const summary = [
    `Forcing ${volunteer.name} into ${seat.role}: required seats filled ${previewRequiredFilled(
      before,
    )} to ${previewRequiredFilled(after)}`,
  ];
  const score = (shape: PreviewPlanShape) =>
    shape.choices.reduce((total, choice) => total + choice.score, 0);
  if (score(before) !== score(after)) {
    summary.push(`Total match score ${score(before)} to ${score(after)}`);
  }
  summary.push(
    becomesUncovered.length === 0
      ? "No seat loses its volunteer"
      : `Uncovered: ${becomesUncovered.join(", ")}`,
  );

  return {
    candidateId: volunteer.id,
    candidateName: volunteer.name,
    slotId: seat.slotId,
    shiftId: seat.shiftId,
    role: seat.role,
    filledBefore: before.choices.length,
    filledAfter: after.choices.length,
    requiredFilledBefore: previewRequiredFilled(before),
    requiredFilledAfter: previewRequiredFilled(after),
    totalScoreBefore: score(before),
    totalScoreAfter: score(after),
    changedAssignments,
    becomesUncovered,
    summary,
  };
}

function previewRosterPlan(
  shiftIds: string[],
  options: RosterOptions,
  policy: RosterPolicy,
  forced?: { candidateId: string; slotId: string },
): RosterPlan {
  const shape = previewPlanShape(shiftIds, options, policy, forced);
  const seats = previewSeats(shiftIds);
  const assignments: PlannedAssignment[] = shape.choices.map((choice) => ({
    shiftId: choice.seat.shiftId,
    opportunityId: choice.seat.opportunityId,
    shiftTitle: choice.seat.shiftTitle,
    role: choice.seat.role,
    candidateId: choice.volunteer.id,
    candidateName: choice.volunteer.name,
    candidateInitials: choice.volunteer.initials,
    startsAt: choice.seat.startsAt,
    score: choice.score,
    breakdown: previewBreakdown(choice.components),
    reasons: [
      `Skill match: ${choice.seat.role}`,
      `${options.preferSpanish && choice.volunteer.languages.includes("Spanish") ? "Spanish-speaking" : "Available"} for ${choice.seat.shiftId}`,
      "Highest score among the eligible volunteers",
    ],
    promoteWaitlist: false,
    eligibleRoles: seats
      .filter((row) => row.shiftId === choice.seat.shiftId)
      .filter((row) =>
        choice.volunteer.skills.some((skill) =>
          skill.toLowerCase().includes(row.requiredSkill.toLowerCase()),
        ),
      )
      .map((row) => row.role),
    explanation: previewExplanation(
      choice.volunteer,
      choice.seat,
      options,
      policy,
      shape.beforeSeat.get(choice.seat.slotId) ?? emptyLoad(),
      true,
    ),
  }));

  return {
    assignments,
    unfilled: shape.unfilled.map((row) => ({
      shiftId: row.seat.shiftId,
      role: row.seat.role,
      reason: row.reason,
      requiredSkill: row.seat.requiredSkill,
      requiredCredential: row.seat.requiredCredential,
    })),
    totalScore: assignments.reduce((total, assignment) => total + assignment.score, 0),
    slotsConsidered: seats.length,
    candidatesConsidered: workspace.volunteers.filter((volunteer) => volunteer.status === "active")
      .length,
    deterministicSeed: 20260415,
    policyVersion: policy.version,
    generatedAt: workspace.now,
    revision,
  };
}

function previewAvailabilityState(
  volunteer: Volunteer,
  seat: PreviewSeat,
): CandidateEvaluation["availability"] {
  if (volunteer.availability.length === 0) return "unknown";
  const exact = volunteer.availability.some(
    (slot) => slot.day === seat.dayKey && slot.period === previewPeriod(seat.startsAt),
  );
  if (exact) return "available";
  return volunteer.availability.some((slot) => slot.day === seat.dayKey)
    ? "partial"
    : "unavailable";
}

/** The read model Rust returns; the screen parses it the same in both modes. */
function previewEvaluation(shiftIds: string[], options: RosterOptions): RosterEvaluation {
  const policy = readRosterPolicy();
  const plan = previewRosterPlan(shiftIds, options, policy);
  const seats = previewSeats(shiftIds);
  const baseLoad = previewBaseLoad();

  const candidates: CandidateEvaluation[] = workspace.volunteers
    .filter((volunteer) => volunteer.status === "active")
    .map((volunteer) => {
      const slots: EvaluatedSlot[] = seats.map((seat) => {
        const explanation = previewExplanation(volunteer, seat, options, policy, baseLoad, false);
        return {
          slotId: seat.slotId,
          shiftId: seat.shiftId,
          shiftTitle: seat.shiftTitle,
          role: seat.role,
          startsAt: seat.startsAt,
          endsAt: seat.endsAt,
          eligible: explanation.eligible,
          selected: plan.assignments.some(
            (assignment) =>
              assignment.candidateId === volunteer.id &&
              assignment.explanation.slotId === seat.slotId,
          ),
          score: explanation.totalScore,
          checks: explanation.checks,
          components: explanation.components,
          selectionReason: explanation.selectionReason,
        };
      });
      const eligibleRoles = [
        ...new Set(slots.filter((slot) => slot.eligible).map((slot) => slot.role)),
      ].sort();
      const bestScore = slots
        .filter((slot) => slot.eligible)
        .map((slot) => slot.score ?? 0)
        .reduce<number | null>(
          (best, score) => (best === null || score > best ? score : best),
          null,
        );
      const conflict = slots
        .flatMap((slot) => slot.checks)
        .find((check) => check.name === "No overlapping shift" && !check.passed)?.detail;
      const eligibleIndex = slots.findIndex((slot) => slot.eligible);
      const availabilitySeat = eligibleIndex >= 0 ? seats[eligibleIndex] : seats[0];
      return {
        candidateId: volunteer.id,
        candidateName: volunteer.name,
        candidateInitials: volunteer.initials,
        eligibleRoles,
        bestScore,
        availability: availabilitySeat
          ? previewAvailabilityState(volunteer, availabilitySeat)
          : "unknown",
        conflict: conflict ?? null,
        weeklyShifts: baseLoad.weekCount.get(volunteer.id) ?? 0,
        weeklyMinutes: 0,
        waitlistedShiftIds: state.waitlist
          .filter((row) => row.volunteerId === volunteer.id && row.status === "waiting")
          .map((row) => row.shiftId),
        slots,
      };
    });

  return {
    generatedAt: workspace.now,
    policyVersion: policy.version,
    revision,
    plan,
    candidates,
  };
}

function previewExplain(
  shiftIds: string[],
  options: RosterOptions,
  candidateId: string,
  slotId: string,
): CandidateAnswer {
  const policy = readRosterPolicy();
  const seat = previewSeats(shiftIds).find((row) => row.slotId === slotId);
  if (!seat) throw new Error("That seat is not open on this shift.");
  const volunteer = workspace.volunteers.find((row) => row.id === candidateId);
  if (!volunteer) throw new Error("That volunteer is not on file.");

  const base = previewPlanShape(shiftIds, options, policy);
  const held = base.choices.find((choice) => choice.seat.slotId === slotId);
  const selected = held?.volunteer.id === candidateId;
  const explanation =
    selected && held
      ? previewExplanation(
          volunteer,
          seat,
          options,
          policy,
          base.beforeSeat.get(slotId) ?? emptyLoad(),
          true,
        )
      : previewExplanation(
          volunteer,
          seat,
          options,
          policy,
          base.beforeSeat.get(slotId) ?? emptyLoad(),
          false,
        );

  const comparison =
    !selected && explanation.eligible
      ? previewComparison(
          base,
          previewPlanShape(shiftIds, options, policy, { candidateId, slotId }),
          volunteer,
          seat,
        )
      : null;

  return { explanation, comparison };
}
