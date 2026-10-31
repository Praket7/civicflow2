import { Fragment, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { HelpProvider } from "../components/help/HelpDialog";
import { FirstRunTour } from "../components/help/FirstRunTour";
import { CommandPalette } from "../components/navigation/CommandPalette";
import { Sidebar } from "../components/navigation/Sidebar";
import { TopBar } from "../components/navigation/TopBar";
import { useAuth } from "../lib/auth/session";
import { useLocale } from "../lib/i18n";
import styles from "./AppShell.module.css";

const COLLAPSE_KEY = "civicflow.sidebar.collapsed";

export function AppShell() {
  const location = useLocation();
  const { user } = useAuth();
  const { locale, version } = useLocale();
  const copyKey = `${locale}:${version}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [mobilePath, setMobilePath] = useState<string | null>(null);
  const mobileOpen = mobilePath === location.pathname;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const role: "coordinator" | "volunteer" =
    user?.role === "coordinator" ? "coordinator" : "volunteer";
  // Check-in owns the full content frame: no global top bar and no canvas
  // padding, because it is used one-handed at a door.
  const surface = location.pathname === "/volunteer/check-in" ? "checkin" : undefined;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") setMobilePath(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, String(!value));
      } catch {
        // Preference is best effort; the rail still works for this session.
      }
      return !value;
    });
  }

  return (
    <HelpProvider>
      <div className={`shell ${styles.shell}`} data-collapsed={collapsed}>
        <a className={styles.skipLink} href="#main-content">
          Skip to main content
        </a>
        <Sidebar
          key={`sidebar-${copyKey}`}
          role={role}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggleCollapsed={toggleCollapsed}
          onDismissMobile={() => setMobilePath(null)}
        />
        <div className={styles.main} data-surface={surface}>
          {surface ? null : (
            <TopBar
              key={`topbar-${copyKey}`}
              onOpenPalette={() => setPaletteOpen(true)}
              onOpenSidebar={() => setMobilePath(location.pathname)}
            />
          )}
          <main id="main-content" className={styles.content} data-surface={surface} tabIndex={-1}>
            <div key={location.pathname} className={styles.pageTransition}>
              <Fragment key={copyKey}>
                <Outlet />
              </Fragment>
            </div>
          </main>
        </div>
        <CommandPalette
          key={`palette-${copyKey}`}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />
        <FirstRunTour role={role} />
      </div>
    </HelpProvider>
  );
}
