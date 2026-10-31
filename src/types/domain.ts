export type Cause = "food" | "education" | "environment" | "health" | "community" | "animals";

/// A role is a property of an organization membership, not of the person. An
/// identity that has not joined an organization yet has no workspace role.
export type AccountRole = "coordinator" | "volunteer" | "none";

export type MembershipRole = "owner" | "coordinator" | "volunteer";
export type MembershipStatus = "active" | "invited" | "disabled";

export interface Account {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
  volunteerId: string | null;
}

export interface AuthSession {
  token: string;
  user: Account;
  expiresAt: string;
}

type VolunteerStatus = "active" | "onboarding" | "inactive";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type PeriodKey = "morning" | "afternoon" | "evening";

export interface Organization {
  id: string;
  name: string;
  initials: string;
  mission: string;
  city: string;
  state: string;
  address: string;
  website: string;
  email: string;
  timezone: string;
  /** Cover picture: a bundled sample or a photo the coordinator uploaded. */
  image?: string;
  imageAlt?: string;
}

interface Person {
  id: string;
  name: string;
  firstName: string;
  initials: string;
  role: string;
  tone: string;
  photo?: string;
}

export interface Coordinator extends Person {
  email: string;
}

export interface AvailabilitySlot {
  day: DayKey;
  period: PeriodKey;
}

export interface Volunteer extends Person {
  birthdate?: string;
  email: string;
  phone: string;
  joinedAt: string;
  status: VolunteerStatus;
  skills: string[];
  languages: string[];
  causes: Cause[];
  hoursVerified: number;
  attendanceRate: number;
  eventsCompleted: number;
  interests: string;
  availability: AvailabilitySlot[];
}

export interface Opportunity {
  id: string;
  slug: string;
  title: string;
  cause: Cause;
  organization: string;
  image: string;
  imageAlt: string;
  description: string;
  address: string;
  distanceMiles: number;
  coordinator: string;
  capacity: number;
  duration: string;
  training: string[];
  requirements: string[];
  impactMetric: string;
}

interface ShiftRole {
  name: string;
  required: number;
  filled: number;
}

export interface Shift {
  id: string;
  opportunityId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  confirmed: number;
  waitlisted: number;
  status: "scheduled" | "completed" | "canceled";
  roles: ShiftRole[];
}

interface HourEntry {
  id: string;
  volunteerId: string;
  opportunityId: string;
  date: string;
  minutes: number;
  status: "verified" | "pending" | "rejected";
  verificationId: string | null;
}

export interface CoverageDay {
  key: DayKey;
  label: string;
  capacity: number;
  confirmed: number;
  percent: number;
}

export interface ImpactSummary {
  hoursYtd: number;
  hoursThisMonth: number;
  uniqueVolunteersYtd: number;
  activeVolunteers: number;
  mealsPacked: number;
  tutoringSessions: number;
  treesPlanted: number;
  familiesServedThisMonth: number;
  shiftsCompleted: number;
  attendanceRate: number;
}

export interface ActivityItem {
  id: string;
  volunteerId: string;
  name: string;
  action: string;
  detail: string;
  tone: string;
  at: string;
}

export interface NotificationItem {
  id: string;
  kind:
    | "coverage"
    | "waitlist"
    | "hours"
    | "credential"
    | "shift"
    | "WAITLIST_PROMOTED"
    | "SHIFT_CHANGED"
    | "SHIFT_CANCELED"
    | "HOURS_APPROVED"
    | "HOURS_ADJUSTED"
    | "HOURS_SUBMITTED"
    | "CREDENTIAL_EXPIRING"
    | "COVERAGE_REQUEST"
    | string;
  title: string;
  body: string;
  priority: "high" | "normal";
  createdAt: string;
  readAt: string | null;
  href: string;
}

interface SavedView {
  id: string;
  name: string;
  filters: Record<string, string[] | undefined>;
}

export interface SavedViewRecord {
  id: string;
  scope: string;
  name: string;
  filtersJson: string;
  createdAt: string;
}

export type ApplicationStage = "applied" | "review" | "onboarding" | "active";

export interface Applicant {
  id: string;
  name: string;
  email: string;
  initials: string;
  tone: string;
  stage: ApplicationStage;
  appliedAt: string;
  source: string;
  cause: Cause;
  skills: string[];
  note: string;
}

export type WaitlistStatus = "waiting" | "promoted" | "declined" | "expired" | "removed";

export interface WaitlistEntry {
  id: string;
  shiftId: string;
  volunteerId: string;
  createdAt: string;
  status: WaitlistStatus;
  position: number;
  eligibleRole: string;
}

export type AttendanceStatus = "expected" | "checked_in" | "completed" | "no_show";

export interface AttendanceEntry {
  volunteerId: string;
  shiftId: string;
  role: string;
  status: AttendanceStatus;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

export type CredentialStatus = "current" | "expiring" | "expired";

export interface Credential {
  id: string;
  volunteerId: string;
  name: string;
  identifier: string;
  issuedAt: string;
  validFrom: string;
  validThrough: string;
  status: CredentialStatus;
  verifiedAt: string | null;
  verifiedBy: string | null;
  notes: string | null;
}

export interface ServiceVerification {
  id: string;
  code: string;
  volunteerId: string;
  organizationId: string;
  dateStart: string;
  dateEnd: string;
  totalMinutes: number;
  issuedAt: string;
  issuedBy: string;
}

export interface ImpactMetric {
  id: string;
  opportunityId: string;
  metricKey: string;
  name: string;
  unit: string;
  value: number;
  recordedAt: string;
}

export interface RetentionCohort {
  label: string;
  eligible: number;
  returned: number;
  rate: number;
}

export interface CheckinCode {
  shiftId: string;
  code: string;
  token: string;
  issuedAt: string;
  expiresAt: string;
  payload: string;
}

export type CheckinStatus = "not_open" | "open" | "closed";

export interface CheckinWindow {
  shiftId: string;
  opensAt: string;
  closesAt: string;
  status: CheckinStatus;
  canSelfCheckIn: boolean;
}

/// Installation-wide, unlike a role inside whichever organization is open.
export interface InstallationAccess {
  steward: boolean;
}

interface ScoreBreakdown {
  skill: number;
  availability: number;
  interest: number;
  preference: number;
  fairness: number;
  reliability: number;
  total: number;
}

export interface ConstraintCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ScoreComponent {
  label: string;
  awarded: number;
  maximum: number;
}

/** The full record of why one person was chosen for one seat. */
export interface MatchExplanation {
  candidateId: string;
  candidateName: string;
  candidateInitials: string;
  slotId: string;
  shiftId: string;
  role: string;
  eligible: boolean;
  checks: ConstraintCheck[];
  components: ScoreComponent[];
  totalScore: number | null;
  selected: boolean;
  selectionReason: string;
}

/** One seat that a different person holds once a decision is forced. */
interface AssignmentChange {
  kind: "lost" | "moved" | "gained" | string;
  shiftId: string;
  shiftTitle: string;
  role: string;
  fromCandidate: string | null;
  toCandidate: string | null;
}

/** What happens to the whole plan if one questioned decision is forced. */
export interface ForcedComparison {
  candidateId: string;
  candidateName: string;
  slotId: string;
  shiftId: string;
  role: string;
  filledBefore: number;
  filledAfter: number;
  requiredFilledBefore: number;
  requiredFilledAfter: number;
  totalScoreBefore: number;
  totalScoreAfter: number;
  changedAssignments: AssignmentChange[];
  becomesUncovered: string[];
  summary: string[];
}

/** The answer to "why this person?" or "why not that one?". */
export interface CandidateAnswer {
  explanation: MatchExplanation;
  comparison: ForcedComparison | null;
}

/** What an unknown age or credential means for the role that requires it. */
type MissingRequirementBehavior = "block" | "allow";

/** The organization's own matching rules, in the words a coordinator chose. */
export interface RosterPolicy {
  version: number;
  maxShiftsPerDay: number | null;
  maxMinutesPerDay: number | null;
  maxShiftsPerWeek: number | null;
  maxMinutesPerWeek: number | null;
  minimumGapMinutes: number;
  unknownAgeBehavior: MissingRequirementBehavior;
  unknownCredentialBehavior: MissingRequirementBehavior;
  skillWeight: number;
  interestWeight: number;
  languageWeight: number;
  fairnessWeight: number;
  reliabilityWeight: number;
  waitlistPreference: boolean;
}

/** A named priority a coordinator picks, and the weight it becomes. */
export interface PriorityLevel {
  key: string;
  weight: number;
}

export interface RosterPolicyView {
  policy: RosterPolicy;
  levels: PriorityLevel[];
  organizationId: string;
}

export interface PlannedAssignment {
  shiftId: string;
  opportunityId: string;
  shiftTitle: string;
  role: string;
  candidateId: string;
  candidateName: string;
  candidateInitials: string;
  startsAt: string;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  promoteWaitlist: boolean;
  eligibleRoles: string[];
  explanation: MatchExplanation;
}

interface UnfilledSlot {
  shiftId: string;
  role: string;
  reason: string;
  requiredSkill: string | null;
  requiredCredential: string | null;
}

export interface RosterPlan {
  assignments: PlannedAssignment[];
  unfilled: UnfilledSlot[];
  totalScore: number;
  slotsConsidered: number;
  candidatesConsidered: number;
  deterministicSeed: number;
  /** Which version of the organization's matching policy produced this plan. */
  policyVersion: number;
  /** When the workspace clock said the plan was generated. */
  generatedAt: string;
  /** The workspace revision the plan was built from; applying a later one is stale. */
  revision: number;
}

/** One seat as one candidate sees it, straight from the matching engine. */
export interface EvaluatedSlot {
  slotId: string;
  shiftId: string;
  shiftTitle: string;
  role: string;
  startsAt: string;
  endsAt: string;
  eligible: boolean;
  selected: boolean;
  score: number | null;
  checks: ConstraintCheck[];
  components: ScoreComponent[];
  selectionReason: string;
}

/** Everything the AutoRoster screen may show about one volunteer. */
export interface CandidateEvaluation {
  candidateId: string;
  candidateName: string;
  candidateInitials: string;
  eligibleRoles: string[];
  bestScore: number | null;
  availability: "available" | "partial" | "unknown" | "unavailable";
  conflict: string | null;
  weeklyShifts: number;
  weeklyMinutes: number;
  waitlistedShiftIds: string[];
  slots: EvaluatedSlot[];
}

/** The plan and the evaluation it was drawn from, generated together. */
export interface RosterEvaluation {
  generatedAt: string;
  policyVersion: number;
  revision: number;
  plan: RosterPlan;
  candidates: CandidateEvaluation[];
}

export interface WeeklyAssignment {
  shiftId: string;
  candidateId: string;
  role: string;
  promoteWaitlist: boolean;
}

export interface RosterApplyAssignment {
  candidateId: string;
  role: string;
  promoteWaitlist: boolean;
}

export interface RosterOptions {
  preferSpanish: boolean;
  blockConflicts: boolean;
  capWeekly: boolean;
  includeWaitlist: boolean;
}

/** A role on a disrupted shift, counted as the shift screen counts it. */
export interface DisruptedRole {
  role: string;
  required: number;
  filled: number;
  open: number;
}

export interface DisruptedShift {
  shiftId: string;
  opportunityId: string;
  title: string;
  startsAt: string;
  capacity: number;
  confirmed: number;
  roles: DisruptedRole[];
  reasons: string[];
}

interface AtRiskAssignment {
  shiftId: string;
  shiftTitle: string;
  startsAt: string;
  volunteerId: string;
  volunteerName: string;
  role: string;
  credential: string;
  validThrough: string | null;
  expired: boolean;
}

/** What is wrong with the roster right now, before anybody plans a repair. */
export interface DisruptionReport {
  now: string;
  shifts: DisruptedShift[];
  openRequired: number;
  atRisk: AtRiskAssignment[];
}

type RecoveryChangeKind = "assign" | "promote" | "move";

export interface RecoveryChange {
  kind: RecoveryChangeKind;
  shiftId: string;
  shiftTitle: string;
  startsAt: string;
  role: string;
  /** The seat a move leaves behind, so the screen can name both ends. */
  fromRole: string | null;
  volunteerId: string;
  volunteerName: string;
  volunteerInitials: string;
  score: number;
  cost: number;
  reason: string;
}

export interface RecoverySeat {
  shiftId: string;
  role: string;
  reason: string;
}

export interface RecoveryPlan {
  shifts: DisruptedShift[];
  changes: RecoveryChange[];
  remaining: RecoverySeat[];
  openBefore: number;
  openAfter: number;
  /** Assignments the plan disturbs, which is the number a coordinator weighs. */
  movedAssignments: number;
  policyVersion: number;
}

/** One seat a coordinator approved. */
export interface RecoveryChangeRequest {
  volunteerId: string;
  role: string;
  fromRole: string | null;
  promoteWaitlist: boolean;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  entityType: "volunteer" | "shift" | "opportunity" | "hours" | "settings" | "backup" | "system";
  entityId: string;
  summary: string;
  detail?: string;
}

interface BackupCounts {
  volunteers: number;
  programs: number;
  shifts: number;
  hours: number;
  notifications: number;
  audit: number;
}

export interface BackupSnapshot {
  id: string;
  createdAt: string;
  kind: "automatic" | "manual";
  bytes: number;
  rows: number;
  note: string;
  counts: BackupCounts;
  sha256: string;
  schemaVersion: number;
  integrity: string;
}

export interface BackupRestoreResult {
  snapshot: SessionSnapshot;
  backups: BackupSnapshot[];
}

/** What the app wrote when it sealed a snapshot with a passphrase. */
export interface EncryptedBackupReceipt {
  path: string;
  bytes: number;
  snapshot: string;
  createdAt: string;
}

export interface ReportRequest {
  template: string;
  fields: string[];
  dateStart?: string | null;
  dateEnd?: string | null;
  cause?: string | null;
  groupBy: "none" | "cause" | "program";
}

export interface ReportSummaryItem {
  label: string;
  value: string;
}

export interface ReportDocument {
  template: string;
  title: string;
  organization: string;
  period: string;
  generatedAt: string;
  headers: string[];
  rows: string[][];
  summary: ReportSummaryItem[];
}

export type ExportFormat = "csv" | "pdf";

export interface ExportReceipt {
  path: string;
  bytes: number;
  format: ExportFormat;
  title: string;
}

export interface WorkspaceSettings {
  organizationName: string;
  contactEmail: string;
  timezone: string;
  weekStartsOn: "monday" | "sunday";
  defaultShiftLength: number;
  autoPromoteWaitlist: boolean;
  hoursRequireApproval: boolean;
  emailDigest: "daily" | "weekly" | "off";
  textScale: "standard" | "large" | "larger";
  highContrast: boolean;
  reducedMotion: boolean;
  underlineLinks: boolean;
  colourIndependent: boolean;
}

export interface HoursDecision {
  status: "verified" | "rejected";
  approvedMinutes: number | null;
  reason: string;
  reviewedAt: string;
}

export interface NewOpportunityInput {
  title: string;
  cause: Cause;
  description: string;
  address: string;
  capacity: number;
  duration: string;
  requirements: string[];
}

interface RegistrationInput {
  shiftId: string;
  volunteerId: string;
  role: string;
  status: "registered" | "canceled" | "completed" | "no_show";
}

export interface CreateOpportunityResult {
  opportunity: Opportunity;
  snapshot: SessionSnapshot;
}

/**
 * As the database holds it; screens turn this into a `Volunteer`, keeping the
 * seed's richer display fields.
 */
export interface RosterVolunteer {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  joinedAt: string;
  skills: string[];
  availability: string[];
  causes: string[];
}

/** One row of a volunteer spreadsheet, with what the importer understood. */
export interface VolunteerImportRow {
  /** The line number as the coordinator's spreadsheet editor shows it. */
  line: number;
  name: string;
  email: string;
  phone: string;
  status: string;
  skills: string[];
  /** Windows in the `mon:morning` form the export writes. */
  availability: string[];
  interests: string;
  causes: string[];
  outcome: "create" | "invalid";
  /** Anything that stops the row being written. */
  problems: string[];
  /** True of the row but not an error, such as a missing skill list. */
  notes: string[];
}

export interface VolunteerImportPreview {
  columns: string[];
  required: string[];
  template: string;
  total: number;
  valid: number;
  invalid: number;
  problems: string[];
  rows: VolunteerImportRow[];
}

export interface VolunteerImportSummary {
  created: number;
  createdIds: string[];
  preview: VolunteerImportPreview;
}

export interface SessionSnapshot {
  savedOpportunityIds: string[];
  attendance: Record<string, AttendanceEntry[]>;
  hoursDecisions: Record<string, HoursDecision>;
  applications: Applicant[];
  waitlist: WaitlistEntry[];
  settings: WorkspaceSettings;
  createdOpportunities: Opportunity[];
  registrations: RegistrationInput[];
  audit: AuditEvent[];
  volunteerProfile: {
    skills: string[];
    availability: AvailabilitySlot[];
    completedOnboarding: boolean;
    phone?: string;
    interests?: string;
    causes?: Cause[];
    photo?: string;
  };
  credentials: Credential[];
  verifications: ServiceVerification[];
  impactMetrics: ImpactMetric[];
  savedViews: SavedViewRecord[];
  retention: RetentionCohort[];
  checkinCode: CheckinCode | null;
  reportExports?: ExportReceipt[];
  /** The whole roster for a coordinator, and only their own row for a volunteer. */
  roster?: RosterVolunteer[];
  /**
   * Shifts a coordinator scheduled from a series. The browser fallback keeps
   * them here because its schedule comes from the seed; the desktop workspace
   * writes real shift rows instead.
   */
  createdSeries?: ShiftSeriesRecord[];
  createdShifts?: SeriesShift[];
}

/** The repeat rule a coordinator filled in. */
export interface RecurrenceRule {
  kind: "none" | "weekly";
  intervalWeeks: number;
  /** Sunday is 0, so the numbering matches the seed's day keys. */
  weekdays: number[];
  /** "HH:MM" in the organization's own clock. */
  startsLocalTime: string;
  durationMinutes: number;
  /** "YYYY-MM-DD": the first day an occurrence may fall on. */
  startsOn: string;
  endsOn: string | null;
  occurrenceCount: number | null;
}

export interface SeriesRole {
  name: string;
  required: number;
}

export interface ShiftSeriesRecord {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  timezone: string;
  kind: "none" | "weekly";
  intervalWeeks: number;
  weekdays: number[];
  startsLocalTime: string;
  durationMinutes: number;
  startsOn: string;
  endsOn: string | null;
  occurrenceCount: number | null;
  /** Shifts this series has actually produced. */
  generated: number;
  roles: SeriesRole[];
}

export interface SeriesShift {
  id: string;
  occurrenceDate: string;
  startsAt: string;
  endsAt: string;
}

export interface SeriesResult {
  series: ShiftSeriesRecord;
  shifts: SeriesShift[];
  snapshot: SessionSnapshot;
}

/** One person waiting for a seat, and whether they can take it. */
export interface WaitlistCandidate {
  volunteerId: string;
  name: string;
  initials: string;
  position: number;
  eligible: boolean;
  reason: string;
  attendanceRate: number;
  joinedAt: string;
}

export interface ReplacementRecommendation {
  shiftId: string;
  shiftTitle: string;
  role: string;
  startsAt: string;
  recommended: WaitlistCandidate | null;
  ranked: WaitlistCandidate[];
  /** The sentence a coordinator reads, including who was passed over. */
  summary: string;
}

/** The reminder triggers the product actually sends. */
export type ReminderTrigger =
  "shift_reminder" | "checkin_soon" | "missed_shift_follow_up" | "credential_expiring";

export interface NotificationRule {
  id: string;
  triggerType: ReminderTrigger;
  offsetMinutes: number;
  audience: "volunteer" | "coordinator";
  enabled: boolean;
}

export interface NotificationRulePatch {
  offsetMinutes?: number;
  enabled?: boolean;
}

/** The rule that fired, in the coordinator's words. */
export type RetentionSignalKind =
  "inactive" | "newVolunteerAtRisk" | "highlyEngaged" | "credentialBlocker";

export interface RetentionSignal {
  volunteerId: string;
  name: string;
  initials: string;
  signal: RetentionSignalKind;
  reason: string;
  history: string[];
  suggestedAction: string;
}

export interface Milestone {
  key: string;
  label: string;
  earned: boolean;
  /** What is still missing, so the next one is visible rather than implied. */
  remaining: string;
}

export interface VolunteerInsight {
  volunteerId: string;
  name: string;
  verifiedHours: number;
  completedShifts: number;
  milestones: Milestone[];
  next: string | null;
}

export interface EngagementMetrics {
  newVolunteers: number;
  return30: number;
  return60: number;
  return90: number;
  inactiveVolunteers: number;
  completedShifts: number;
  noShowRate: number;
  lateCancellationRate: number;
  averageLeadDays: number;
  waitlistPromotions: number;
  waitlistPromotionRate: number;
}

export interface CredentialReadiness {
  current: number;
  expiringSoon: number;
  expired: number;
  /** Assignments on future shifts whose credential lapses before the shift. */
  assignmentsAtRisk: number;
}

export interface DemoWorkspace {
  schemaVersion: number;
  now: string;
  organization: Organization;
  coordinator: Coordinator;
  currentVolunteerId: string;
  volunteers: Volunteer[];
  opportunities: Opportunity[];
  shifts: Shift[];
  hourEntries: HourEntry[];
  mayaEntries: HourEntry[];
  credentials: Credential[];
  registrations: RegistrationInput[];
  impactRecords: ImpactMetric[];
  impact: ImpactSummary;
  recentActivity: ActivityItem[];
  notifications: NotificationItem[];
  savedViews: SavedView[];
}

export interface AttentionItem {
  id: string;
  opportunityId: string;
  title: string;
  detail: string;
  cause: Cause;
  severity: "critical" | "warning" | "info";
  href: string;
  sortKey: string;
}

export interface MissionControlSummary {
  coordinatorName: string;
  firstName: string;
  organizationName: string;
  now: string;
  activeVolunteers: number;
  coveragePercent: number;
  hoursThisMonth: number;
  upcomingShifts: number;
  attentionCount: number;
  coverageDays: CoverageDay[];
  attention: AttentionItem[];
  recentActivity: ActivityItem[];
  impact: ImpactSummary;
  unreadNotifications: number;
  photos: string[];
}
