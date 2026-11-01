import { NavLink } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Database,
  ExternalLink,
  Users,
} from "lucide-react";
import styles from "./shared.module.css";

const links = [
  { to: "/shared/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/shared/participation", label: "Participation", icon: ClipboardCheck },
  { to: "/shared/volunteers", label: "Volunteers", icon: Users },
  { to: "/shared/reports", label: "Reports", icon: BarChart3 },
  { to: "/shared/conflicts", label: "Conflicts", icon: AlertTriangle },
  { to: "/shared/replica", label: "Synced copy", icon: Database },
] as const;

export function SharedNav({ conflicts = 0 }: { conflicts?: number }) {
  return (
    <nav className={styles.nav} aria-label="Shared coordinator">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            [styles.navLink, isActive ? styles.navLinkActive : ""].filter(Boolean).join(" ")
          }
        >
          <link.icon aria-hidden size={13} />
          {link.label}
          {link.to === "/shared/conflicts" && conflicts > 0 ? (
            <span className={styles.pill}>{conflicts}</span>
          ) : null}
        </NavLink>
      ))}
      <a className={`${styles.navLink} ${styles.navSpacer}`} href="/shared">
        <ExternalLink aria-hidden size={13} />
        Hosted workspace
      </a>
    </nav>
  );
}
