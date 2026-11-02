import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { useCloud } from "../../lib/sync/provider";
import { formatShiftRange } from "../../lib/sync/views";
import { markAllRead, markRead } from "../../lib/sync/notifications";
import { messageOf } from "../../lib/errors";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageTitle,
  Pill,
  formatMinutes,
  relativeTime,
} from "../ui";
import { parseScannedCode, ScanField } from "../scanner";
import styles from "../pwa.module.css";
import { ShiftRow, useTimezone } from "./common";

export function SignInScreen() {
  const { signIn } = useCloud();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <main className={styles.authPage}>
      <div className={styles.authPanel}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden>
            CF
          </span>
          <div>
            <p className={styles.brandName}>CivicFlow</p>
            <p className={styles.brandSub}>Volunteer</p>
          </div>
        </div>
        <PageTitle
          eyebrow="Welcome back"
          title="Your next shift is waiting."
          body="Sign in with the email your coordinator invited. This app works offline once you're in."
        />
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            setProblem(null);
            setBusy(true);
            void signIn(email, password)
              .catch((caught: unknown) => {
                setProblem(messageOf(caught));
              })
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.org"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
            />
          </Field>
          {problem ? (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          ) : null}
          <Button type="submit" loading={busy}>
            Sign in <ArrowRight aria-hidden size={17} />
          </Button>
        </form>
        <p className={styles.finePrint}>
          Trouble signing in? Ask your coordinator to check your invitation. Passwords are managed
          by your organization's account provider.
        </p>
      </div>
    </main>
  );
}

export function ScheduleScreen() {
  const { view } = useCloud();
  const timezone = useTimezone();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  if (!view) return <p className={styles.loading}>Loading schedule…</p>;
  const shifts = tab === "upcoming" ? view.upcoming : view.past;

  return (
    <div className={styles.stack}>
      <PageTitle eyebrow="Schedule" title="Your time, planned." />
      <div className={styles.tabs} role="tablist" aria-label="Schedule">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "upcoming"}
          className={[styles.tab, tab === "upcoming" ? styles.tabActive : ""].join(" ")}
          onClick={() => setTab("upcoming")}
        >
          Upcoming
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "past"}
          className={[styles.tab, tab === "past" ? styles.tabActive : ""].join(" ")}
          onClick={() => setTab("past")}
        >
          Past
        </button>
      </div>
      {shifts.length === 0 ? (
        <Card>
          <EmptyState
            title={tab === "upcoming" ? "Nothing scheduled yet" : "No past shifts"}
            body={
              tab === "upcoming"
                ? "Register from Discover and the shift appears here."
                : "Completed shifts and their hours will collect here."
            }
          />
          {tab === "upcoming" ? (
            <Link to="/discover" className={styles.inlineLink}>
              Find an opportunity <ArrowRight aria-hidden size={16} />
            </Link>
          ) : null}
        </Card>
      ) : (
        <ul className={styles.list}>
          {shifts.map((shift) => (
            <ShiftRow key={shift.id} shift={shift} timezone={timezone} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function HoursScreen() {
  const { view } = useCloud();
  if (!view) return <p className={styles.loading}>Loading hours…</p>;
  return (
    <div className={styles.stack}>
      <PageTitle
        eyebrow="Hours & impact"
        title="Proof of the work you did."
        body="Only approved hours count. A pending entry is waiting for a coordinator."
      />
      <div className={styles.statRow}>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>Approved</span>
          <strong>{formatMinutes(view.approvedMinutes)}</strong>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>Pending</span>
          <strong>{formatMinutes(view.pendingMinutes)}</strong>
        </Card>
      </div>
      {view.hours.length === 0 ? (
        <Card>
          <EmptyState
            title="No hours logged yet"
            body="Hours appear after a coordinator records or approves service."
          />
        </Card>
      ) : (
        <ul className={styles.list}>
          {view.hours.map((entry) => (
            <Card as="li" key={entry.id} className={styles.hourRow}>
              <div>
                <p className={styles.hourTitle}>{entry.opportunityTitle || "Service"}</p>
                <p className={styles.shiftMeta}>{entry.date}</p>
                {entry.note ? <p className={styles.muted}>{entry.note}</p> : null}
              </div>
              <div className={styles.hourEnd}>
                <strong>{formatMinutes(entry.approvedMinutes ?? entry.minutes)}</strong>
                <Pill
                  tone={
                    entry.status === "verified"
                      ? "good"
                      : entry.status === "rejected"
                        ? "bad"
                        : "warn"
                  }
                >
                  {entry.status}
                </Pill>
              </div>
            </Card>
          ))}
        </ul>
      )}
      <Card>
        <h2 className={styles.cardTitle}>How approval works</h2>
        <p className={styles.body}>
          A coordinator reviews submitted hours against attendance. If an entry is adjusted, the
          reason stays on the record, and you can ask about it before it becomes verified service.
        </p>
      </Card>
    </div>
  );
}

export function NotificationsScreen() {
  const { view, workspace, syncNow } = useCloud();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!view || !workspace) return <p className={styles.loading}>Loading notifications…</p>;

  const unread = view.notifications.filter((notification) => !notification.readAt).length;

  async function readAll() {
    if (!workspace) return;
    setBusy(true);
    setProblem(null);
    try {
      await markAllRead(workspace.organizationId);
      await syncNow();
    } catch (caught) {
      setProblem(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <PageTitle
        eyebrow="Notifications"
        title="What changed."
        body="Reminders are generated by your organization, not by this device."
      />
      {unread > 0 ? (
        <div className={styles.rowActions}>
          <Button variant="secondary" loading={busy} onClick={() => void readAll()}>
            Mark all {unread} read
          </Button>
        </div>
      ) : null}
      {problem ? <p className={styles.error}>{problem}</p> : null}
      {view.notifications.length === 0 ? (
        <Card>
          <EmptyState title="Nothing new" body="Shift changes and waitlist updates land here." />
        </Card>
      ) : (
        <ul className={styles.list}>
          {view.notifications.map((notification) => (
            <Card as="li" key={notification.id} className={styles.noticeRow}>
              <span
                className={[styles.unreadDot, notification.readAt ? styles.readDot : ""].join(" ")}
                aria-hidden
              />
              <div>
                <p className={styles.noticeTitle}>{notification.title}</p>
                <p className={styles.noticeBody}>{notification.body}</p>
                <p className={styles.muted}>{relativeTime(notification.createdAt)}</p>
                {notification.href ? (
                  <Link
                    to={notification.href}
                    className={styles.noticeLink}
                    onClick={() => {
                      void markRead(notification.id).then(() => syncNow());
                    }}
                  >
                    Open <ArrowRight aria-hidden size={14} />
                  </Link>
                ) : null}
              </div>
              {notification.priority === "high" ? <Pill tone="bad">Important</Pill> : null}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HelpScreen() {
  return (
    <div className={styles.stack}>
      <PageTitle eyebrow="Help" title="How the volunteer app works." />

      <Card>
        <h2 className={styles.cardTitle}>Your week, start to finish</h2>
        <ol className={styles.steps}>
          <li>Browse Discover for a shift that fits your skills and availability.</li>
          <li>Open the shift to read the meeting point, checklist, and arrival notes.</li>
          <li>Check in at the door with the six-digit code from the check-in table.</li>
          <li>Review My Hours after a coordinator approves the time you served.</li>
        </ol>
      </Card>

      <Card>
        <h2 className={styles.cardTitle}>Rules that matter at the door</h2>
        <ul className={styles.steps}>
          <li>Check-in opens 30 minutes before a shift and closes 15 minutes after it starts.</li>
          <li>The event code is six digits and rotates every 15 minutes.</li>
          <li>
            A cancellation frees the seat and offers it to the first eligible person on the
            waitlist.
          </li>
          <li>Only approved hours count toward a verified service record.</li>
        </ul>
      </Card>

      <Card>
        <h2 className={styles.cardTitle}>Common questions</h2>
        <div className={styles.helpFaq}>
          <details>
            <summary>Why can a shift look full but still show an open role?</summary>
            <p className={styles.body}>
              Seat count and role coverage answer different questions. A shift can be at capacity
              and still need a driver, so the role stays open until someone qualified claims it.
            </p>
          </details>
          <details>
            <summary>What happens when I cancel?</summary>
            <p className={styles.body}>
              Your seat is released, the first eligible waitlisted volunteer is offered it, and the
              change is recorded in the audit log.
            </p>
          </details>
          <details>
            <summary>Why are my hours still pending?</summary>
            <p className={styles.body}>
              Attendance and submitted time are reviewed by a coordinator. Approved time appears in
              My Hours and on your verification record; pending time does not.
            </p>
          </details>
          <details>
            <summary>Does the app work without a signal?</summary>
            <p className={styles.body}>
              Your schedule and shift details are cached on the device. Changes you make offline are
              queued under your account and sent when the connection returns.
            </p>
          </details>
        </div>
      </Card>

      <Link className={styles.helpLink} to="/settings">
        Back to settings <ArrowRight aria-hidden size={14} />
      </Link>
    </div>
  );
}

export function CheckInScreen() {
  const { id } = useParams<{ id: string }>();
  const { view, queue } = useCloud();
  const timezone = useTimezone();
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const shift = view?.shifts.find((entry) => entry.id === id);
  if (!view) return <p className={styles.loading}>Loading check-in…</p>;
  if (!shift) {
    return (
      <Card>
        <EmptyState
          title="Shift not found"
          body="This check-in link does not match a shift here."
        />
        <Button variant="secondary" onClick={() => navigate("/")}>
          Back home
        </Button>
      </Card>
    );
  }

  const range = formatShiftRange(shift.startsAt, shift.endsAt, timezone);
  const alreadyIn =
    shift.attendance?.status === "checked_in" || shift.attendance?.status === "completed";

  if (alreadyIn || submitted) {
    return (
      <div className={styles.stack}>
        <Card className={styles.doneCard}>
          <CheckCircle2 aria-hidden size={40} />
          <h1>You're checked in.</h1>
          <p className={styles.body}>
            {shift.title} · {range.day}, {range.time}
          </p>
          <p className={styles.muted}>
            Check-out opens automatically. Your hours stay pending until a coordinator reviews them.
          </p>
          <Button variant="secondary" onClick={() => navigate("/")}>
            Back home
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <Link to={`/shift/${shift.id}`} className={styles.back}>
        <ArrowLeft aria-hidden size={16} /> Shift details
      </Link>
      <PageTitle
        eyebrow="Check in"
        title={shift.title}
        body={`${range.day} · ${range.time}. Scan the code at the check-in table.`}
      />
      {shift.canCheckIn ? null : (
        <p className={styles.offlineNote}>
          Self check-in opens 30 minutes before the shift and closes 15 minutes after it starts. The
          server enforces the window, so a scan outside it will be refused rather than silently
          accepted.
        </p>
      )}
      {problem ? <p className={styles.error}>{problem}</p> : null}
      <Card>
        <ScanField
          disabled={busy}
          onCode={(raw) => {
            const code = parseScannedCode(raw);
            if (!code) {
              setProblem("That code was not readable. Try again or type the digits.");
              return;
            }
            setBusy(true);
            setProblem(null);
            void queue("CHECK_IN", {
              shiftId: shift.id,
              volunteerId: view.volunteerId,
              code,
              clientAt: new Date().toISOString(),
            })
              .then(() => setSubmitted(true))
              .catch((caught: unknown) => setProblem(messageOf(caught)))
              .finally(() => setBusy(false));
          }}
        />
      </Card>
      <p className={styles.finePrint}>
        A check-in made offline is saved here and sent when you reconnect. The server still checks
        the code's expiry and the shift window, so a late upload may be refused.
      </p>
    </div>
  );
}
