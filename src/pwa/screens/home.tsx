import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  MapPin,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useCloud } from "../../lib/sync/provider";
import { formatShiftRange } from "../../lib/sync/views";
import { Button, Card, EmptyState, Pill, SyncBar, formatMinutes, useInstallPrompt } from "../ui";
import styles from "../pwa.module.css";
import { ShiftRow, shiftStatus, useTimezone } from "./common";

export function HomeScreen() {
  const { view, workspace, status, syncNow, pendingShiftIds } = useCloud();
  const timezone = useTimezone();
  const navigate = useNavigate();
  const [install, setInstall] = useState(false);

  if (!view) return <p className={styles.loading}>Loading your workspace…</p>;

  const registered = view.upcoming.filter((shift) => shift.registration);
  const next = registered[0] ?? view.upcoming[0];
  const expiring = view.credentials.filter((credential) => credential.status !== "current");
  const unread = view.notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className={styles.stack}>
      <header className={styles.homeHeader}>
        <div>
          <p className={styles.eyebrow}>{workspace?.organization.name}</p>
          <h1 className={styles.greeting}>Hi, {view.firstName}.</h1>
        </div>
        {view.photo ? (
          <img className={styles.avatar} src={view.photo} alt="" />
        ) : (
          <span className={styles.avatar} aria-hidden>
            {view.initials}
          </span>
        )}
      </header>

      <SyncBar status={status} onRetry={() => void syncNow()} />

      {next ? (
        <Card className={styles.heroCard}>
          <div className={styles.heroTop}>
            <Pill tone={shiftStatus(next).tone}>{shiftStatus(next).label}</Pill>
            <span className={styles.heroDate}>
              {formatShiftRange(next.startsAt, next.endsAt, timezone).day}
            </span>
          </div>
          <h2>{next.title}</h2>
          <p className={styles.heroMeta}>
            <Clock3 aria-hidden size={15} />
            {formatShiftRange(next.startsAt, next.endsAt, timezone).time} ·{" "}
            {formatShiftRange(next.startsAt, next.endsAt, timezone).duration}
          </p>
          {next.address ? (
            <p className={styles.heroMeta}>
              <MapPin aria-hidden size={15} />
              {next.address}
            </p>
          ) : null}
          <div className={styles.heroActions}>
            {next.canCheckIn ? (
              <Button onClick={() => navigate(`/checkin/${next.id}`)}>
                <CheckCircle2 aria-hidden size={17} /> Check in
              </Button>
            ) : (
              <Button onClick={() => navigate(`/shift/${next.id}`)}>
                {next.registration ? "Shift details" : "View and register"}{" "}
                <ArrowRight aria-hidden size={17} />
              </Button>
            )}
            {next.pending ? <span className={styles.queued}>Saved on this device</span> : null}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            title="No shifts on the calendar yet"
            body="When your coordinator publishes an opportunity, it will appear here — even offline."
          />
          <Button variant="secondary" onClick={() => navigate("/discover")}>
            Browse opportunities
          </Button>
        </Card>
      )}

      <div className={styles.statRow}>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>Hours verified</span>
          <strong>{formatMinutes(view.approvedMinutes)}</strong>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>Shifts coming</span>
          <strong>{view.upcoming.length}</strong>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>Unread</span>
          <strong>{unread}</strong>
        </Card>
      </div>

      {expiring.length > 0 ? (
        <Card className={styles.caution}>
          <ShieldAlert aria-hidden size={19} />
          <div>
            <p className={styles.cautionTitle}>
              {expiring.length} credential{expiring.length === 1 ? "" : "s"} need attention
            </p>
            <p className={styles.cautionBody}>{expiring.map((entry) => entry.name).join(", ")}</p>
          </div>
          <Link to="/profile" className={styles.cautionLink}>
            Review
          </Link>
        </Card>
      ) : null}

      <section>
        <div className={styles.sectionHead}>
          <h2>Also coming up</h2>
          <Link to="/schedule">All shifts</Link>
        </div>
        {view.upcoming.filter((shift) => shift.id !== next?.id).length === 0 ? (
          <p className={styles.muted}>Nothing else scheduled.</p>
        ) : (
          <ul className={styles.list}>
            {view.upcoming
              .filter((shift) => shift.id !== next?.id)
              .slice(0, 4)
              .map((shift) => (
                <ShiftRow key={shift.id} shift={shift} timezone={timezone} />
              ))}
          </ul>
        )}
      </section>

      {pendingShiftIds.length > 0 ? (
        <p className={styles.queuedNote}>
          <TriangleAlert aria-hidden size={15} /> {pendingShiftIds.length} change
          {pendingShiftIds.length === 1 ? "" : "s"} waiting to sync. Keep this app open or come back
          when you have a signal.
        </p>
      ) : null}

      <Card className={styles.installCard}>
        <Download aria-hidden size={19} />
        <div>
          <p className={styles.installTitle}>Install CivicFlow</p>
          <p className={styles.installBody}>
            Add it to your Home Screen for reminders and reliable offline access.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setInstall(true)}>
          How
        </Button>
      </Card>
      {install ? <InstallHelp onClose={() => setInstall(false)} /> : null}
    </div>
  );
}

function InstallHelp({ onClose }: { onClose: () => void }) {
  const { canInstall, install } = useInstallPrompt();
  return (
    <Card className={styles.noticeCard}>
      <p className={styles.noticeTitle}>Add to Home Screen</p>
      <ol className={styles.steps}>
        <li>iPhone: tap Share, then “Add to Home Screen”.</li>
        <li>Android: tap the browser menu, then “Install app”.</li>
        <li>Desktop: use the install icon in the address bar.</li>
      </ol>
      <p className={styles.finePrint}>
        On iPhone, notifications only work after CivicFlow is installed and opened from the Home
        Screen.
      </p>
      <div className={styles.rowActions}>
        {canInstall ? <Button onClick={() => void install()}>Install now</Button> : null}
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Card>
  );
}
