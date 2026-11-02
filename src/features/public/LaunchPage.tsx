import { ArrowRight, Check, LogIn } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "../../lib/i18n";
import { demoWorkspace } from "../../lib/workspace/dataset";
import { getShiftRows, getUpcomingShiftRows } from "../../lib/workspace/selectors";
import styles from "./LaunchPage.module.css";

// The launch screen is public, so it reads the bundled seed rather than the
// signed-in workspace. No volunteer record reaches this page before sign-in.
export function LaunchPage() {
  const workspace = demoWorkspace;
  const shifts = getShiftRows(workspace);
  const upcoming = getUpcomingShiftRows(workspace);

  const checks = [
    {
      title: t("Database verified"),
      detail: t("{volunteers} volunteers · {shifts} shifts · {programs} programs", {
        volunteers: workspace.volunteers.length,
        shifts: shifts.length,
        programs: workspace.opportunities.length,
      }),
    },
    {
      title: t("Backup ready"),
      detail: t("A local snapshot is written when the workspace first opens"),
    },
    {
      title: t("Ready offline"),
      detail: t("{count} upcoming shifts need no internet", { count: upcoming.length }),
    },
  ];

  return (
    <div className={styles.launch}>
      <header className={styles.masthead}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
              <path
                d="M4.2 8.6c4.6-4.9 11.2-4.9 15.8-.9-4.7 4.6-11.2 4.8-15.8.9Z"
                fill="currentColor"
              />
              <path
                d="M4.4 15.1c4.4-4.3 10.6-4.4 15.2-.7-4.6 4.4-10.8 4.6-15.2.7Z"
                fill="currentColor"
                opacity="0.6"
              />
            </svg>
          </span>
          <span className={styles.wordmark}>CivicFlow</span>
        </div>
        <span className={styles.mastheadMeta}>Local workspace · v0.1.2</span>
      </header>

      <main className={styles.stage}>
        <section className={styles.copy} aria-labelledby="launch-title">
          <p className={styles.kicker}>
            {workspace.organization.name} · {workspace.organization.city},{" "}
            {workspace.organization.state}
          </p>
          <h1 className={styles.headline} id="launch-title">
            The volunteer desk is open.
          </h1>
          <p className={styles.lede}>
            Sign in to load today&rsquo;s schedule, check-in list and hours ledger. Everything stays
            on this device. No network required.
          </p>

          <div className={styles.actions}>
            <Link className={styles.primaryAction} to="/welcome">
              Open workspace
              <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
            </Link>
            <Link className={styles.secondaryAction} to="/sign-in">
              <LogIn size={14} strokeWidth={1.9} aria-hidden="true" />
              Sign in
            </Link>
            <Link className={styles.tertiaryAction} to="/create-account">
              Create account
            </Link>
          </div>

          <p className={styles.reassurance}>
            Everything stays on this device. Closing the app does not erase it.
          </p>
        </section>

        <aside className={styles.statusCard} aria-label="Workspace readiness">
          <div className={styles.statusHead}>
            <span className={styles.statusKicker}>Startup checks</span>
            <span className={styles.statusCount}>3 of 3</span>
          </div>
          <ul className={styles.checks}>
            {checks.map((check) => (
              <li key={check.title} className={styles.check}>
                <span className={styles.checkTop}>
                  <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                  {check.title}
                </span>
                <span className={styles.checkDetail}>{check.detail}</span>
              </li>
            ))}
          </ul>
          <p className={styles.statusFoot}>
            Read at startup · volunteer records stay in the local SQLite database
          </p>
        </aside>
      </main>

      <figure className={styles.cityStrip}>
        <img
          className={styles.cityImage}
          src="/media/buffalo-skyline.jpg"
          alt="Buffalo, New York, seen from across the water"
        />
        <span className={styles.cityScrim} aria-hidden="true" />
        <figcaption className={styles.cityCaption}>
          <span>Buffalo, New York</span>
          <span>Peter S / Wikimedia Commons · CC BY-SA 4.0</span>
        </figcaption>
      </figure>

      <footer className={styles.footer}>
        <span>v0.1.2 · Local-first desktop build</span>
        <span>
          {workspace.organization.city}, {workspace.organization.state} ·{" "}
          {workspace.organization.timezone}
        </span>
      </footer>
    </div>
  );
}
