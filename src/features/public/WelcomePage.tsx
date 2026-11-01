import { useState } from "react";
import { ArrowRight, Database, ShieldCheck, WifiOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { accountHome, useAuth } from "../../lib/auth/session";
import { t } from "../../lib/i18n";
import styles from "./WelcomePage.module.css";
import { messageOf } from "../../lib/errors";

const trustChips: { label: string; icon: typeof WifiOff; tone: "green" | "violet" | "teal" }[] = [
  { label: "Runs offline", icon: WifiOff, tone: "green" },
  { label: "Data stays on this device", icon: Database, tone: "violet" },
  { label: "Account stays on this device", icon: ShieldCheck, tone: "teal" },
];

export function WelcomePage() {
  const { user, openDemo } = useAuth();
  const navigate = useNavigate();
  const [demoError, setDemoError] = useState<string | null>(null);

  async function exploreDemo() {
    setDemoError(null);
    try {
      const session = await openDemo(true);
      navigate(accountHome(session.user));
    } catch (caught) {
      setDemoError(messageOf(caught));
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.photoPanel} aria-labelledby="welcome-statement">
        <img
          className={styles.photo}
          src="/media/welcome-volunteer.jpg"
          alt="A volunteer smiling while packing food at a community distribution"
        />
        <div className={styles.scrim} aria-hidden="true" />

        <Link className={styles.brand} to="/welcome" aria-label="CivicFlow welcome">
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M4.2 8.6c4.6-4.9 11.2-4.9 15.8-.9-4.7 4.6-11.2 4.8-15.8.9Z" fill="#071b32" />
              <path
                d="M4.4 15.1c4.4-4.3 10.6-4.4 15.2-.7-4.6 4.4-10.8 4.6-15.2.7Z"
                fill="#071b32"
                opacity="0.62"
              />
            </svg>
          </span>
          <span className={styles.brandName}>CivicFlow</span>
        </Link>

        <div className={styles.photoCopy}>
          <p className={styles.photoEyebrow}>Coordinators and volunteers</p>
          <h2 className={styles.statement} id="welcome-statement">
            The work is local. So is the record.
          </h2>
          <p className={styles.photoBody}>
            CivicFlow keeps the schedule, the roster, the hours, and the proof that they happened on
            this device — no account on a server, no signal required.
          </p>
        </div>

        <Link className={styles.credit} to="/credits">
          Photo: Pexels · Credits
        </Link>
      </section>

      <section className={styles.panel} aria-labelledby="welcome-title">
        <div className={styles.panelInner}>
          <p className={styles.panelEyebrow}>
            <ShieldCheck size={13} strokeWidth={1.9} aria-hidden="true" />
            Local-first volunteer operations
          </p>
          <h1 className={styles.title} id="welcome-title">
            Service, organized.
          </h1>
          <p className={styles.lede}>
            Schedule volunteers, fill the gaps before Sunday, and keep hours that hold up when
            someone asks for proof.
          </p>

          <div className={styles.actions}>
            {user ? (
              <Link className={styles.primaryAction} to={accountHome(user)}>
                Continue as {user.name.split(" ")[0]}
                <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
              </Link>
            ) : (
              <Link className={styles.primaryAction} to="/sign-in">
                Sign in
                <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
              </Link>
            )}
            {user ? null : (
              <>
                <Link className={styles.secondaryAction} to="/create-account">
                  Create an account
                </Link>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => void exploreDemo()}
                >
                  Explore the demo
                </button>
              </>
            )}
          </div>
          <p className={styles.actionNote}>
            {user
              ? "This device still has your session. Continue where you left off."
              : "Creating an account only proves who you are. You choose an organization next."}
          </p>
          {demoError ? (
            <p className={styles.actionNote} role="alert">
              {demoError}
            </p>
          ) : null}

          <dl className={styles.roleList}>
            <div>
              <dt>Coordinators</dt>
              <dd>Build shifts, run AutoRoster, approve hours, and report the month.</dd>
            </div>
            <div>
              <dt>Volunteers</dt>
              <dd>Join an organization, claim a shift, check in, and keep a record.</dd>
            </div>
          </dl>

          <div className={styles.trust}>
            <h2 className={styles.trustTitle}>How this workspace runs</h2>
            <ul className={styles.chips}>
              {trustChips.map((chip) => {
                const Icon = chip.icon;
                return (
                  <li className={styles.chip} data-tone={chip.tone} key={chip.label}>
                    <Icon size={12} strokeWidth={2} aria-hidden="true" />
                    {t(chip.label)}
                  </li>
                );
              })}
            </ul>
          </div>

          {user ? null : (
            <div className={styles.signIn}>
              <p>
                Just looking? <Link to="/sign-in">Open the demo workspace</Link> from the sign-in
                screen. It loads a sample organization and needs no password of your own.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
