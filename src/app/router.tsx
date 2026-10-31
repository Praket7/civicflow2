import type { ReactNode } from "react";
import { createBrowserRouter, createHashRouter, Navigate } from "react-router-dom";
import { accountHome, useAuth } from "../lib/auth/session";
import { isTauri } from "../lib/platform";
import { WorkspaceSessionProvider } from "../lib/workspace/session";
import { AccessibilityPage } from "../features/settings/AccessibilityPage";
import { AskPage } from "../features/ask/AskPage";
import { ApplicationsPage } from "../features/recruitment/ApplicationsPage";
import { AttendancePage } from "../features/attendance/AttendancePage";
import { AuditPage } from "../features/records/AuditPage";
import { AutoRosterPage } from "../features/coverage/AutoRosterPage";
import { BackupPage } from "../features/records/BackupPage";
import { CheckInPage } from "../features/volunteer/CheckInPage";
import { DesktopReplicaPage } from "../pwa/DesktopReplicaPage";
import { SharedConflictsPage } from "../features/shared/SharedConflictsPage";
import { SharedParticipationPage } from "../features/shared/SharedParticipationPage";
import { SharedSchedulePage } from "../features/shared/SharedSchedulePage";
import { CoveragePage } from "../features/coverage/CoveragePage";
import { CreateOpportunityPage } from "../features/schedule/CreateOpportunityPage";
import { CredentialsPage } from "../features/credentials/CredentialsPage";
import { CustomReportPage } from "../features/reports/CustomReportPage";
import { DiscoverPage } from "../features/volunteer/DiscoverPage";
import { HelpPage } from "../features/help/HelpPage";
import { HoursReviewPage } from "../features/hours/HoursReviewPage";
import { ImpactAnalyticsPage } from "../features/impact/ImpactAnalyticsPage";
import { ImpactReportPage } from "../features/reports/ImpactReportPage";
import { KioskPage } from "../features/attendance/KioskPage";
import { LaunchPage } from "../features/public/LaunchPage";
import { MissionControlPage } from "../features/mission-control/MissionControlPage";
import { MyHoursPage } from "../features/volunteer/MyHoursPage";
import { MySchedulePage } from "../features/volunteer/MySchedulePage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { OnboardingPage } from "../features/volunteer/OnboardingPage";
import { OpportunitiesPage } from "../features/opportunities/OpportunitiesPage";
import { OpportunityDetailPage } from "../features/volunteer/OpportunityDetailPage";
import { OpportunityManagementPage } from "../features/opportunities/OpportunityManagementPage";
import { CoordinatorStartPage } from "../features/organizations/CoordinatorStartPage";
import { OrganizationAccessPage } from "../features/organizations/OrganizationAccessPage";
import { OrganizationCreatePage } from "../features/organizations/OrganizationCreatePage";
import { VolunteerStartPage } from "../features/organizations/VolunteerStartPage";
import { PersonalImpactPage } from "../features/volunteer/PersonalImpactPage";
import { RecordsPage } from "../features/records/RecordsPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { RetentionPage } from "../features/insights/RetentionPage";
import { SavedPage } from "../features/volunteer/SavedPage";
import { SchedulePage } from "../features/schedule/SchedulePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { SharedWorkspacePage } from "../pwa/SharedWorkspacePage";
import { ShiftRosterPage } from "../features/coordinator/ShiftRosterPage";
import { SignInPage } from "../features/public/SignInPage";
import { SignUpPage } from "../features/public/SignUpPage";
import { VerificationPage } from "../features/volunteer/VerificationPage";
import { VolunteerDetailPage } from "../features/volunteers/VolunteerDetailPage";
import { VolunteerHomePage } from "../features/volunteer/VolunteerHomePage";
import { VolunteerProfilePage } from "../features/volunteer/VolunteerProfilePage";
import { VolunteerShiftPage } from "../features/volunteer/VolunteerShiftPage";
import { VolunteersPage } from "../features/volunteers/VolunteersPage";
import { AuthCallbackPage } from "../features/public/AuthCallbackPage";
import { ForgotPasswordPage } from "../features/public/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/public/ResetPasswordPage";
import { WelcomePage } from "../features/public/WelcomePage";
import { AppShell } from "./AppShell";
import { RequireAuth } from "./RequireAuth";
import { CreditsPage } from "./CreditsPage";
import { routes } from "./routes";

const standaloneNumbers = new Set([1, 2, 3, 4, 5, 31, 43, 44, 45, 46, 47, 48, 49]);

// The hosted workspace mounts its own history and never enters the local app
// shell, so these routes are registered once, below, instead of twice.
const sharedNumbers = new Set([52, 53, 54, 55, 56]);

// Exported so tests can mount every registered screen without duplicating the map.
export const pages: Record<string, ReactNode> = {
  launch: <LaunchPage />,
  welcome: <WelcomePage />,
  "sign-in": <SignInPage />,
  "create-account": <SignUpPage />,
  "forgot-password": <ForgotPasswordPage />,
  "reset-password": <ResetPasswordPage />,
  "auth-callback": <AuthCallbackPage />,
  "volunteer-onboarding": <OnboardingPage />,
  "coordinator-start": <CoordinatorStartPage />,
  "organization-create": <OrganizationCreatePage />,
  "organization-access": <OrganizationAccessPage />,
  "volunteer-start": <VolunteerStartPage />,
  "volunteer-home": <VolunteerHomePage />,
  discover: <DiscoverPage />,
  "opportunity-detail": <OpportunityDetailPage />,
  saved: <SavedPage />,
  "my-schedule": <MySchedulePage />,
  "volunteer-shift": <VolunteerShiftPage />,
  "check-in": <CheckInPage />,
  "my-hours": <MyHoursPage />,
  "personal-impact": <PersonalImpactPage />,
  "service-verification": <VerificationPage />,
  "volunteer-profile": <VolunteerProfilePage />,
  notifications: <NotificationsPage />,
  "mission-control": <MissionControlPage />,
  coverage: <CoveragePage />,
  autoroster: <AutoRosterPage />,
  schedule: <SchedulePage />,
  opportunities: <OpportunitiesPage />,
  "create-opportunity": <CreateOpportunityPage />,
  "opportunity-management": <OpportunityManagementPage />,
  "coordinator-shift": <ShiftRosterPage />,
  volunteers: <VolunteersPage />,
  "volunteer-detail": <VolunteerDetailPage />,
  applications: <ApplicationsPage />,
  credentials: <CredentialsPage />,
  attendance: <AttendancePage />,
  kiosk: <KioskPage />,
  "hours-review": <HoursReviewPage />,
  reports: <ReportsPage />,
  "custom-report": <CustomReportPage />,
  "impact-analytics": <ImpactAnalyticsPage />,
  insights: <RetentionPage />,
  "impact-report": <ImpactReportPage />,
  records: <RecordsPage />,
  audit: <AuditPage />,
  backup: <BackupPage />,
  settings: <SettingsPage />,
  accessibility: <AccessibilityPage />,
  ask: <AskPage />,
  "shared-workspace": <SharedWorkspacePage />,
  "shared-schedule": <SharedSchedulePage />,
  "shared-participation": <SharedParticipationPage />,
  "shared-conflicts": <SharedConflictsPage />,
  "shared-replica": <DesktopReplicaPage />,
};

/** Each account goes to its own home, not a fixed coordinator route. */
function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? accountHome(user) : "/welcome"} replace />;
}

function guarded(route: (typeof routes)[number]) {
  const page = pages[route.id];
  if (route.role === "public") return page;
  // Display preferences and the question box read the same records for both
  // roles, so both roles may open them.
  const roles =
    route.id === "settings" || route.id === "accessibility" || route.id === "ask"
      ? (["coordinator", "volunteer"] as const)
      : undefined;
  // Choosing the first organization happens before a workspace exists.
  const needsWorkspace = ![
    "/coordinator/start",
    "/coordinator/organization/new",
    "/volunteer/start",
  ].includes(route.path);
  return (
    <RequireAuth
      accountRole={route.role as "coordinator" | "volunteer"}
      roles={roles ? [...roles] : undefined}
    >
      {needsWorkspace ? <WorkspaceSessionProvider>{page}</WorkspaceSessionProvider> : page}
    </RequireAuth>
  );
}

const standaloneRoutes = routes
  .filter((route) => standaloneNumbers.has(route.number))
  .map((route) => ({ path: route.path, element: guarded(route) }));

const shellRoutes = routes
  .filter((route) => !standaloneNumbers.has(route.number) && !sharedNumbers.has(route.number))
  .map((route) => ({ path: route.path, element: guarded(route) }));

const routeConfig = [
  ...standaloneRoutes,
  {
    // The hosted workspace shares the desktop window, but not its router: the
    // cloud client keeps its own history so a scan deep link never rewrites the
    // local workspace address.
    path: "/shared",
    element: (
      <RequireAuth>
        <SharedWorkspacePage />
      </RequireAuth>
    ),
  },
  {
    path: "/shared/schedule",
    element: (
      <RequireAuth>
        <SharedSchedulePage />
      </RequireAuth>
    ),
  },
  {
    path: "/shared/participation",
    element: (
      <RequireAuth>
        <SharedParticipationPage />
      </RequireAuth>
    ),
  },
  {
    path: "/shared/conflicts",
    element: (
      <RequireAuth>
        <SharedConflictsPage />
      </RequireAuth>
    ),
  },
  {
    // The desktop's own replica is readable offline and shows what the
    // organization has accepted. Coordinator writes live on the shared screens.
    path: "/shared/replica",
    element: (
      <RequireAuth>
        <DesktopReplicaPage />
      </RequireAuth>
    ),
  },
  {
    path: "/",
    element: (
      <RequireAuth>
        <WorkspaceSessionProvider>
          <AppShell />
        </WorkspaceSessionProvider>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: "/coordinator/people", element: <Navigate to="/coordinator/volunteers" replace /> },
      ...shellRoutes,
      {
        path: "/coordinator/notifications",
        element: (
          <RequireAuth accountRole="coordinator">
            <WorkspaceSessionProvider>
              <NotificationsPage />
            </WorkspaceSessionProvider>
          </RequireAuth>
        ),
      },
      { path: "/credits", element: <CreditsPage /> },
      { path: "/help", element: <HelpPage /> },
      { path: "*", element: <HomeRedirect /> },
    ],
  },
];

// The Tauri asset protocol does not rewrite deep links to index.html, so the
// desktop build uses hash history.
export const router = isTauri() ? createHashRouter(routeConfig) : createBrowserRouter(routeConfig);
