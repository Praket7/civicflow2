import { useEffect } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  Compass,
  House,
  Settings,
  ShieldAlert,
  Timer,
  UserRound,
} from "lucide-react";
import { useCloud } from "../lib/sync/provider";
import { CoordinatorApp } from "./coordinator";
import {
  CheckInScreen,
  DiscoverScreen,
  HomeScreen,
  HoursScreen,
  NotificationsScreen,
  ProfileScreen,
  ScheduleScreen,
  SettingsScreen,
  ShiftDetailScreen,
  SignInScreen,
} from "./screens";
import { Button } from "./ui";
import styles from "./pwa.module.css";

interface NavEntry {
  to: string;
  label: string;
  icon: typeof House;
  end?: boolean;
}

const NAV: NavEntry[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/hours", label: "Hours", icon: Timer },
  { to: "/profile", label: "Profile", icon: UserRound },
];

export function PwaApp() {
  const { phase, error, workspace, view, conflicts, signOut } = useCloud();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  if (phase === "loading") {
    return (
      <main className={styles.splash}>
        <span className={styles.brandMark} aria-hidden>
          CF
        </span>
        <p>CivicFlow Volunteer</p>
        <span className={styles.loadingBar} aria-hidden />
      </main>
    );
  }

  if (phase === "signed-out") return <SignInScreen />;

  if (phase === "error") {
    return (
      <main className={styles.authPage}>
        <div className={styles.authPanel}>
          <ShieldAlert aria-hidden size={30} />
          <h1 className={styles.errorTitle}>This workspace could not open</h1>
          <p className={styles.body}>{error}</p>
          <div className={styles.rowActions}>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </div>
        </div>
      </main>
    );
  }

  if (workspace && workspace.role !== "volunteer") return <CoordinatorApp />;

  // A revoked device must stop inviting writes. The conflict is the server's
  // answer, so it wins over whatever the cached role still says.
  if (conflicts.some((conflict) => conflict.code === "stale_authority")) {
    return <AccessChanged />;
  }

  return (
    <div className={styles.shell}>
      <TopBar />
      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/discover" element={<DiscoverScreen />} />
          <Route path="/shift/:id" element={<ShiftRoute />} />
          <Route path="/schedule" element={<ScheduleScreen />} />
          <Route path="/hours" element={<HoursScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/notifications" element={<NotificationsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/checkin/:id" element={<CheckInScreen />} />
          <Route path="*" element={<HomeScreen />} />
        </Routes>
      </main>
      {location.pathname.startsWith("/checkin") ? null : <BottomNav />}
      {view?.status === "inactive" ? (
        <p className={styles.inactiveNote}>
          Your roster profile is marked inactive. Ask a coordinator.
        </p>
      ) : null}
    </div>
  );
}

/** A shift screen owns its own result message, so a new id is a new screen. */
function ShiftRoute() {
  const { id } = useParams<{ id: string }>();
  return <ShiftDetailScreen key={id} />;
}

function AccessChanged() {
  const { workspace, conflicts, dismissConflict, signOut } = useCloud();
  return (
    <main className={styles.authPage}>
      <div className={styles.authPanel}>
        <ShieldAlert aria-hidden size={30} />
        <h1 className={styles.errorTitle}>Your access changed</h1>
        <p className={styles.body}>
          This device saved changes while it still had access to{" "}
          {workspace?.organization.name ?? "this organization"}. The server refused them because
          your membership changed while you were offline.
        </p>
        <p className={styles.body}>
          Nothing was overwritten in the shared workspace. Sign in again once an owner restores your
          access.
        </p>
        <div className={styles.rowActions}>
          <Button
            onClick={() => {
              for (const conflict of conflicts) {
                if (conflict.code === "stale_authority") void dismissConflict(conflict.id);
              }
            }}
          >
            Dismiss and continue
          </Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}

function TopBar() {
  const { workspace, view } = useCloud();
  const navigate = useNavigate();
  const unread = view?.notifications.filter((notification) => !notification.readAt).length ?? 0;
  return (
    <header className={styles.topBar}>
      <button type="button" className={styles.orgButton} onClick={() => navigate("/settings")}>
        <span className={styles.orgMark} aria-hidden>
          {view?.initials ?? "CF"}
        </span>
        <span className={styles.orgCopy}>
          <span className={styles.orgName}>{workspace?.organization.name ?? "CivicFlow"}</span>
          <span className={styles.orgSub}>Volunteer</span>
        </span>
      </button>
      <div className={styles.topActions}>
        <NavLink
          to="/notifications"
          className={styles.iconButton}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell aria-hidden size={19} />
          {unread > 0 ? <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span> : null}
        </NavLink>
        <NavLink to="/settings" className={styles.iconButton} aria-label="Settings">
          <Settings aria-hidden size={19} />
        </NavLink>
      </div>
    </header>
  );
}

function BottomNav() {
  return (
    <nav className={styles.bottomNav} aria-label="Main">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => [styles.navItem, isActive ? styles.navActive : ""].join(" ")}
        >
          <Icon aria-hidden size={21} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
