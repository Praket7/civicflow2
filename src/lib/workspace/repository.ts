import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  Account,
  AccountRole,
  AuthSession,
  BackupRestoreResult,
  BackupSnapshot,
  CandidateAnswer,
  CheckinCode,
  CheckinWindow,
  CreateOpportunityResult,
  CredentialReadiness,
  DisruptionReport,
  EngagementMetrics,
  EncryptedBackupReceipt,
  ExportFormat,
  ExportReceipt,
  HoursDecision,
  InstallationAccess,
  MissionControlSummary,
  NewOpportunityInput,
  NotificationItem,
  NotificationRule,
  NotificationRulePatch,
  Opportunity,
  RecoveryChangeRequest,
  RecoveryPlan,
  RecurrenceRule,
  ReportDocument,
  ReportRequest,
  ReplacementRecommendation,
  RetentionSignal,
  RosterApplyAssignment,
  RosterEvaluation,
  RosterOptions,
  RosterPlan,
  RosterPolicy,
  RosterPolicyView,
  SeriesResult,
  SeriesRole,
  SessionSnapshot,
  ShiftSeriesRecord,
  VolunteerInsight,
  VolunteerImportPreview,
  VolunteerImportSummary,
  WeeklyAssignment,
  WorkspaceSettings,
} from "../../types/domain";
import type { HostedIdentity } from "../auth/hosted";
import type {
  IssuedInvite,
  NewOrganizationInput,
  OrganizationAccess,
  OrganizationDetailsPatch,
  OrganizationMember,
  OrganizationProfile,
  PendingInvite,
} from "../organizations/types";
import { isTauri } from "../platform";
import { previewRepository } from "./previewRepository";

/**
 * The single data boundary: desktop invokes Rust commands that own SQLite and
 * the audit log; the preview repository mirrors the same contract.
 */
export interface WorkspaceRepository {
  readonly source: "desktop" | "preview";
  signIn(email: string, password: string, remember: boolean): Promise<AuthSession>;
  /** Creates the bundled demo workspace on request and signs in as its coordinator. */
  openDemoWorkspace(): Promise<AuthSession>;
  createAccount(name: string, email: string, password: string): Promise<AuthSession>;
  /** Resumes the local workspace behind an email the hosted provider verified. */
  signInWithHosted(identity: HostedIdentity): Promise<AuthSession>;
  signOut(token: string): Promise<void>;
  currentUser(token: string): Promise<Account | null>;
  listAccounts(token: string): Promise<Account[]>;
  resetPassword(token: string, userId: string, newPassword: string): Promise<void>;

  /** Organization access comes from membership rows, never from the screen. */
  listOrganizations(): Promise<OrganizationAccess[]>;
  listPublicOrganizations(): Promise<OrganizationProfile[]>;
  /** `null` parks the workspace while an identity has no membership yet. */
  selectOrganization(organizationId: string | null): Promise<void>;
  createOrganization(input: NewOrganizationInput): Promise<OrganizationAccess>;
  updateOrganization(
    organizationId: string,
    patch: OrganizationDetailsPatch,
  ): Promise<OrganizationProfile>;
  listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]>;
  listOrganizationInvites(organizationId: string): Promise<PendingInvite[]>;
  createOrganizationInvite(
    organizationId: string,
    role: "coordinator" | "volunteer",
    email: string,
  ): Promise<IssuedInvite>;
  revokeOrganizationInvite(organizationId: string, inviteId: string): Promise<void>;
  redeemOrganizationInvite(code: string): Promise<OrganizationAccess>;
  joinPublicOrganization(organizationId: string): Promise<OrganizationAccess>;
  setOrganizationMemberRole(
    organizationId: string,
    userId: string,
    role: "coordinator" | "volunteer",
  ): Promise<OrganizationMember[]>;
  setOrganizationMemberStatus(
    organizationId: string,
    userId: string,
    status: "active" | "disabled",
  ): Promise<OrganizationMember[]>;
  transferOrganizationOwnership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember[]>;
  getSnapshot(): Promise<SessionSnapshot>;
  setSaved(opportunityId: string, saved: boolean): Promise<SessionSnapshot>;
  setApplicationStage(applicationId: string, stage: string): Promise<SessionSnapshot>;
  /** Self check-in; the rotating code is what proves the volunteer is present. */
  checkIn(shiftId: string, volunteerId: string, code: string): Promise<SessionSnapshot>;
  /** A coordinator recording an arrival by hand, with a reason on the record. */
  manualCheckIn(shiftId: string, volunteerId: string, reason: string): Promise<SessionSnapshot>;
  checkOut(shiftId: string, volunteerId: string): Promise<SessionSnapshot>;
  markNoShow(shiftId: string, volunteerId: string): Promise<SessionSnapshot>;
  cancelRegistration(
    shiftId: string,
    volunteerId: string,
    reason?: string,
  ): Promise<SessionSnapshot>;
  joinWaitlist(shiftId: string, volunteerId: string, role: string): Promise<SessionSnapshot>;
  getCheckinCode(shiftId: string): Promise<CheckinCode>;
  checkinWindow(shiftId: string): Promise<CheckinWindow>;
  installationAccess(): Promise<InstallationAccess>;
  autoRoster(shiftIds: string[], options: RosterOptions): Promise<RosterPlan>;
  /** The plan plus the evaluation; screens format these values, never derive them. */
  evaluateRoster(shiftIds: string[], options: RosterOptions): Promise<RosterEvaluation>;
  /** Applies a reviewed plan across every shift in one transaction. */
  applyRosterWeek(
    expectedRevision: number | null,
    expectedPolicyVersion: number | null,
    assignments: WeeklyAssignment[],
  ): Promise<SessionSnapshot>;
  /** The matching policy in force, with the priority levels the screen offers. */
  getRosterPolicy(): Promise<RosterPolicyView>;
  updateRosterPolicy(policy: RosterPolicy): Promise<RosterPolicyView>;
  /** Why this person, or why not that one, from the planner's own rules. */
  explainRosterChoice(
    shiftIds: string[],
    options: RosterOptions,
    candidateId: string,
    slotId: string,
  ): Promise<CandidateAnswer>;
  applyRoster(shiftId: string, assignments: RosterApplyAssignment[]): Promise<SessionSnapshot>;
  /**
   * What is wrong with the roster right now: required seats with nobody in them,
   * and credentials that will not be valid when an assigned shift starts.
   */
  detectDisruptions(): Promise<DisruptionReport>;
  /**
   * A minimal repair for the chosen shifts. Coverage comes first, then how few
   * assignments the plan disturbs, then match quality. A locked assignment is
   * never moved.
   */
  planRecovery(shiftIds: string[], options: RosterOptions): Promise<RecoveryPlan>;
  /** Applies the approved changes in one transaction, one audit event each. */
  applyRecovery(shiftId: string, changes: RecoveryChangeRequest[]): Promise<SessionSnapshot>;
  /** Holds an assignment still so recovery and AutoRoster cannot move it. */
  setAssignmentLock(
    shiftId: string,
    volunteerId: string,
    locked: boolean,
  ): Promise<SessionSnapshot>;
  /** Schedules a repeating shift series and every instance it produces. */
  createShiftSeries(
    opportunityId: string,
    rule: RecurrenceRule,
    roles: SeriesRole[],
  ): Promise<SeriesResult>;
  listShiftSeries(opportunityId?: string): Promise<ShiftSeriesRecord[]>;
  /** Adds the occurrences the rule asks for that the series has not produced. */
  generateSeriesInstances(seriesId: string): Promise<SeriesResult>;
  /** Retimes one shift of the series, or the rule and every shift it made. */
  retimeShiftSeries(
    seriesId: string,
    startsLocalTime: string,
    durationMinutes: number,
    scope: "instance" | "series",
  ): Promise<SessionSnapshot>;
  deleteShiftSeries(seriesId: string): Promise<SessionSnapshot>;
  /** Who should take an opened seat, and why the people ahead were skipped. */
  recommendReplacement(shiftId: string, role: string): Promise<ReplacementRecommendation>;
  listNotificationRules(): Promise<NotificationRule[]>;
  updateNotificationRule(ruleId: string, patch: NotificationRulePatch): Promise<NotificationRule[]>;
  /** Queues every reminder that is due, and returns how many it wrote. */
  queueDueReminders(): Promise<number>;
  /** The transparent rules behind who might need attention. */
  retentionSignals(): Promise<RetentionSignal[]>;
  /** One volunteer's verified hours, completed shifts, and milestones. */
  volunteerInsight(volunteerId: string): Promise<VolunteerInsight>;
  engagementMetrics(): Promise<EngagementMetrics>;
  credentialReadiness(): Promise<CredentialReadiness>;
  promoteWaitlist(shiftId: string, volunteerId: string): Promise<SessionSnapshot>;
  reviewHours(entryId: string, decision: HoursDecision): Promise<SessionSnapshot>;
  updateSettings(patch: Partial<WorkspaceSettings>): Promise<SessionSnapshot>;
  createOpportunity(input: NewOpportunityInput): Promise<{
    opportunity: Opportunity;
    snapshot: SessionSnapshot;
  }>;
  registerForShift(shiftId: string, volunteerId: string, role: string): Promise<SessionSnapshot>;
  saveVolunteerProfile(
    patch: Partial<SessionSnapshot["volunteerProfile"]>,
  ): Promise<SessionSnapshot>;
  resetDemo(): Promise<SessionSnapshot>;
  listBackups(): Promise<BackupSnapshot[]>;
  createBackup(note?: string): Promise<BackupSnapshot[]>;
  restoreBackup(id: string): Promise<BackupRestoreResult>;
  /** Seals a snapshot and writes it wherever the coordinator chooses. */
  exportEncryptedBackup(passphrase: string): Promise<EncryptedBackupReceipt | null>;
  /** Restores from a sealed file, after the same checks a local snapshot passes. */
  importEncryptedBackup(passphrase: string): Promise<BackupRestoreResult | null>;
  getMissionControl(role?: AccountRole): Promise<MissionControlSummary>;
  getNotifications(role: AccountRole): Promise<NotificationItem[]>;
  markNotificationRead(id: string, role: AccountRole): Promise<void>;
  saveReportView(name: string, scope: string, filtersJson: string): Promise<SessionSnapshot>;
  generateReport(request: ReportRequest): Promise<ReportDocument>;
  exportReport(request: ReportRequest, format: ExportFormat): Promise<ExportReceipt | null>;
  /** Row-by-row check that writes nothing. */
  previewVolunteerImport(text: string): Promise<VolunteerImportPreview>;
  /** One transaction; any bad row refuses the whole file. */
  applyVolunteerImport(text: string): Promise<VolunteerImportSummary>;
  /** Writes the roster in the shape the import reads, for editing and return. */
  exportVolunteerRoster(): Promise<ExportReceipt | null>;
}

// The same shape the core suggests, so the dialog and the file agree.
function encryptedBackupName(): string {
  return `civicflow-backup-${new Date().toISOString().slice(0, 10)}.civicflow`;
}

// The only credential the IPC bridge accepts.
let activeToken: string | null = null;

export function setRepositoryToken(token: string | null): void {
  activeToken = token;
}

function withToken(args: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...args, token: activeToken ?? "" };
}

const desktopRepository: WorkspaceRepository = {
  source: "desktop",
  signIn: (email, password, remember) =>
    invoke<AuthSession>("sign_in", { email, password, remember }),
  openDemoWorkspace: () => invoke<AuthSession>("open_demo_workspace"),
  createAccount: (name, email, password) =>
    invoke<AuthSession>("create_account", { name, email, password }),
  signInWithHosted: (identity) =>
    invoke<AuthSession>("sign_in_with_hosted", {
      name: identity.name,
      email: identity.email,
    }),
  signOut: async (token) => {
    await invoke<boolean>("sign_out", { token });
  },
  currentUser: (token) => invoke<Account | null>("current_user", { token }),
  listAccounts: (token) => invoke<Account[]>("list_accounts", { token }),
  resetPassword: async (token, userId, newPassword) => {
    await invoke<null>("reset_password", { token, userId, newPassword });
  },
  listOrganizations: () => invoke<OrganizationAccess[]>("list_my_organizations", withToken()),
  listPublicOrganizations: () => invoke<OrganizationProfile[]>("list_public_organizations"),
  selectOrganization: async (organizationId) => {
    if (!organizationId) return;
    await invoke<OrganizationAccess>("select_organization", withToken({ organizationId }));
  },
  createOrganization: (input) =>
    invoke<OrganizationAccess>("create_organization", withToken({ input })),
  updateOrganization: (organizationId, patch) =>
    invoke<OrganizationProfile>("update_organization", withToken({ organizationId, patch })),
  listOrganizationMembers: (organizationId) =>
    invoke<OrganizationMember[]>("list_organization_members", withToken({ organizationId })),
  listOrganizationInvites: (organizationId) =>
    invoke<PendingInvite[]>("list_organization_invites", withToken({ organizationId })),
  createOrganizationInvite: (organizationId, role, email) =>
    invoke<IssuedInvite>("create_organization_invite", withToken({ organizationId, role, email })),
  revokeOrganizationInvite: async (organizationId, inviteId) => {
    await invoke<null>("revoke_organization_invite", withToken({ organizationId, inviteId }));
  },
  redeemOrganizationInvite: (code) =>
    invoke<OrganizationAccess>("redeem_organization_invite", withToken({ code })),
  joinPublicOrganization: (organizationId) =>
    invoke<OrganizationAccess>("join_public_organization", withToken({ organizationId })),
  setOrganizationMemberRole: (organizationId, userId, role) =>
    invoke<OrganizationMember[]>(
      "set_organization_member_role",
      withToken({ organizationId, userId, role }),
    ),
  setOrganizationMemberStatus: (organizationId, userId, status) =>
    invoke<OrganizationMember[]>(
      "set_organization_member_status",
      withToken({ organizationId, userId, status }),
    ),
  transferOrganizationOwnership: (organizationId, userId) =>
    invoke<OrganizationMember[]>(
      "transfer_organization_ownership",
      withToken({ organizationId, userId }),
    ),
  getSnapshot: () => invoke<SessionSnapshot>("get_workspace_snapshot", withToken()),
  setSaved: (opportunityId, saved) =>
    invoke<SessionSnapshot>("set_saved_opportunity", withToken({ opportunityId, saved })),
  setApplicationStage: (applicationId, stage) =>
    invoke<SessionSnapshot>("set_application_stage", withToken({ applicationId, stage })),
  checkIn: (shiftId, volunteerId, code) =>
    invoke<SessionSnapshot>("check_in_volunteer", withToken({ shiftId, volunteerId, code })),
  manualCheckIn: (shiftId, volunteerId, reason) =>
    invoke<SessionSnapshot>("manual_check_in", withToken({ shiftId, volunteerId, reason })),
  checkOut: (shiftId, volunteerId) =>
    invoke<SessionSnapshot>("check_out_volunteer", withToken({ shiftId, volunteerId })),
  markNoShow: (shiftId, volunteerId) =>
    invoke<SessionSnapshot>("mark_volunteer_no_show", withToken({ shiftId, volunteerId })),
  cancelRegistration: (shiftId, volunteerId, reason) =>
    invoke<SessionSnapshot>(
      "cancel_registration",
      withToken({
        shiftId,
        volunteerId,
        reason: reason ?? null,
      }),
    ),
  joinWaitlist: (shiftId, volunteerId, role) =>
    invoke<SessionSnapshot>("join_waitlist", withToken({ shiftId, volunteerId, role })),
  getCheckinCode: (shiftId) => invoke<CheckinCode>("get_checkin_code", withToken({ shiftId })),
  checkinWindow: (shiftId) => invoke<CheckinWindow>("checkin_window", withToken({ shiftId })),
  installationAccess: () => invoke<InstallationAccess>("installation_access", withToken()),
  autoRoster: (shiftIds, options) =>
    invoke<RosterPlan>("auto_roster", withToken({ shiftIds, options })),
  evaluateRoster: (shiftIds, options) =>
    invoke<RosterEvaluation>("evaluate_roster_candidates", withToken({ shiftIds, options })),
  applyRosterWeek: (expectedRevision, expectedPolicyVersion, assignments) =>
    invoke<SessionSnapshot>(
      "apply_roster_week",
      withToken({ expectedRevision, expectedPolicyVersion, assignments }),
    ),
  getRosterPolicy: () => invoke<RosterPolicyView>("get_roster_policy", withToken()),
  updateRosterPolicy: (policy) =>
    invoke<RosterPolicyView>("update_roster_policy", withToken({ policy })),
  explainRosterChoice: (shiftIds, options, candidateId, slotId) =>
    invoke<CandidateAnswer>(
      "explain_roster_choice",
      withToken({ shiftIds, options, candidateId, slotId }),
    ),
  applyRoster: (shiftId, assignments) =>
    invoke<SessionSnapshot>("apply_roster_plan", withToken({ shiftId, assignments })),
  detectDisruptions: () => invoke<DisruptionReport>("detect_disruptions", withToken()),
  planRecovery: (shiftIds, options) =>
    invoke<RecoveryPlan>("plan_recovery", withToken({ shiftIds, options })),
  applyRecovery: (shiftId, changes) =>
    invoke<SessionSnapshot>("apply_recovery", withToken({ shiftId, changes })),
  setAssignmentLock: (shiftId, volunteerId, locked) =>
    invoke<SessionSnapshot>("set_assignment_lock", withToken({ shiftId, volunteerId, locked })),
  createShiftSeries: (opportunityId, rule, roles) =>
    invoke<SeriesResult>("create_shift_series", withToken({ opportunityId, rule, roles })),
  listShiftSeries: (opportunityId) =>
    invoke<ShiftSeriesRecord[]>(
      "list_shift_series",
      withToken({ opportunityId: opportunityId ?? null }),
    ),
  generateSeriesInstances: (seriesId) =>
    invoke<SeriesResult>("generate_series_instances", withToken({ seriesId })),
  retimeShiftSeries: (seriesId, startsLocalTime, durationMinutes, scope) =>
    invoke<SessionSnapshot>(
      "retime_shift_series",
      withToken({ seriesId, startsLocalTime, durationMinutes, scope }),
    ),
  deleteShiftSeries: (seriesId) =>
    invoke<SessionSnapshot>("delete_shift_series", withToken({ seriesId })),
  recommendReplacement: (shiftId, role) =>
    invoke<ReplacementRecommendation>("recommend_replacement", withToken({ shiftId, role })),
  listNotificationRules: () => invoke<NotificationRule[]>("list_notification_rules", withToken()),
  updateNotificationRule: (ruleId, patch) =>
    invoke<NotificationRule[]>("update_notification_rule", withToken({ ruleId, patch })),
  queueDueReminders: () => invoke<number>("queue_due_reminders", withToken()),
  retentionSignals: () => invoke<RetentionSignal[]>("retention_signals", withToken()),
  volunteerInsight: (volunteerId) =>
    invoke<VolunteerInsight>("volunteer_insight", withToken({ volunteerId })),
  engagementMetrics: () => invoke<EngagementMetrics>("engagement_metrics", withToken()),
  credentialReadiness: () => invoke<CredentialReadiness>("credential_readiness", withToken()),
  promoteWaitlist: (shiftId, volunteerId) =>
    invoke<SessionSnapshot>("promote_waitlist", withToken({ shiftId, volunteerId })),
  reviewHours: (entryId, decision) =>
    invoke<SessionSnapshot>(
      "review_hours",
      withToken({
        entryId,
        status: decision.status,
        approvedMinutes: decision.approvedMinutes,
        reason: decision.reason,
      }),
    ),
  updateSettings: (patch) =>
    invoke<SessionSnapshot>("update_workspace_settings", withToken({ patch })),
  createOpportunity: (input) =>
    invoke<CreateOpportunityResult>("create_opportunity", withToken({ input })),
  registerForShift: (shiftId, volunteerId, role) =>
    invoke<SessionSnapshot>("register_for_shift", withToken({ shiftId, volunteerId, role })),
  saveVolunteerProfile: (patch) =>
    invoke<SessionSnapshot>(
      "save_volunteer_profile",
      withToken({
        skills: patch.skills ?? [],
        availability: patch.availability ?? [],
        completedOnboarding: patch.completedOnboarding ?? true,
        phone: patch.phone ?? "",
        interests: patch.interests ?? "",
        causes: patch.causes ?? [],
        photo: patch.photo ?? "",
      }),
    ),
  resetDemo: () => invoke<SessionSnapshot>("reset_demo", withToken()),
  listBackups: () => invoke<BackupSnapshot[]>("list_backups", withToken()),
  createBackup: (note) => invoke<BackupSnapshot[]>("create_backup", withToken({ note })),
  restoreBackup: (id) => invoke<BackupRestoreResult>("restore_backup", withToken({ id })),
  exportEncryptedBackup: async (passphrase) => {
    const path = await save({
      title: "Save an encrypted backup",
      defaultPath: encryptedBackupName(),
      filters: [{ name: "CivicFlow archive", extensions: ["civicflow"] }],
    });
    if (!path) return null;
    return invoke<EncryptedBackupReceipt>(
      "export_encrypted_backup",
      withToken({ path, passphrase }),
    );
  },
  importEncryptedBackup: async (passphrase) => {
    const chosen = await open({
      title: "Open an encrypted backup",
      multiple: false,
      directory: false,
      filters: [{ name: "CivicFlow archive", extensions: ["civicflow"] }],
    });
    if (!chosen || typeof chosen !== "string") return null;
    return invoke<BackupRestoreResult>(
      "import_encrypted_backup",
      withToken({ path: chosen, passphrase }),
    );
  },
  getMissionControl: () => invoke<MissionControlSummary>("get_mission_control", withToken()),
  getNotifications: () => invoke<NotificationItem[]>("list_notifications", withToken()),
  markNotificationRead: async (id: string) => {
    await invoke<boolean>("mark_notification_read", withToken({ id }));
  },
  saveReportView: (name, scope, filtersJson) =>
    invoke<SessionSnapshot>("save_report_view", withToken({ name, scope, filtersJson })),
  generateReport: (request) => invoke<ReportDocument>("generate_report", withToken({ request })),
  exportReport: async (request, format) => {
    const document = await invoke<ReportDocument>("generate_report", withToken({ request }));
    const extension = format === "pdf" ? "pdf" : "csv";
    const slug = document.template.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const path = await save({
      title: `Export ${document.title}`,
      defaultPath: `civicflow-${slug}-${document.period.slice(0, 10)}.${extension}`,
      filters: [
        {
          name: extension === "pdf" ? "PDF report" : "CSV report",
          extensions: [extension],
        },
      ],
    });
    if (!path) return null;
    return invoke<ExportReceipt>("export_report", withToken({ request, format, path }));
  },
  previewVolunteerImport: (text) =>
    invoke<VolunteerImportPreview>("preview_volunteer_import", withToken({ text })),
  applyVolunteerImport: (text) =>
    invoke<VolunteerImportSummary>("apply_volunteer_import", withToken({ text })),
  exportVolunteerRoster: async () => {
    const path = await save({
      title: "Export the volunteer roster",
      defaultPath: "civicflow-volunteer-roster.csv",
      filters: [{ name: "CSV roster", extensions: ["csv"] }],
    });
    if (!path) return null;
    return invoke<ExportReceipt>("export_volunteer_roster", withToken({ path }));
  },
};

export function getWorkspaceRepository(): WorkspaceRepository {
  return isTauri() ? desktopRepository : previewRepository;
}

/**
 * The seeded browser store. The desktop shell uses the same implementation for
 * an organization created in the app, so those workspaces stay isolated from the
 * local SQLite demo workspace.
 */
export { previewRepository };
