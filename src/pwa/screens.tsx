import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Heart,
  MapPin,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { CommandType } from "../lib/sync/protocol";
import { useCloud } from "../lib/sync/provider";
import {
  disablePush,
  enablePush,
  loadPreferences,
  loadPushConfig,
  markAllRead,
  markRead,
  pushState,
  savePreferences,
  type NotificationPreferences,
  type PushConfig,
  type PushState,
} from "../lib/sync/notifications";
import { formatShiftRange, type ShiftView } from "../lib/sync/views";
import { parseScannedCode, ScanField } from "./scanner";
import {
  Button,
  Card,
  EmptyState,
  Field,
  formatMinutes,
  Input,
  PageTitle,
  Pill,
  relativeTime,
  SyncBar,
  useInstallPrompt,
} from "./ui";
import styles from "./pwa.module.css";

const CAUSE_LABEL: Record<string, string> = {
  food: "Food security",
  education: "Education",
  environment: "Environment",
  health: "Health",
  community: "Community",
  animals: "Animals",
};

function causeLabel(cause: string): string {
  return CAUSE_LABEL[cause] ?? "Community";
}

function shiftStatus(shift: ShiftView): {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral" | "accent";
} {
  if (shift.status === "canceled") return { label: "Canceled", tone: "bad" };
  if (shift.attendance?.status === "checked_in") return { label: "Checked in", tone: "good" };
  if (shift.attendance?.status === "completed") return { label: "Completed", tone: "good" };
  if (shift.attendance?.status === "no_show") return { label: "No show", tone: "bad" };
  if (shift.registration) return { label: "You're in", tone: "good" };
  if (shift.waitlistPosition) return { label: `Waitlist #${shift.waitlistPosition}`, tone: "warn" };
  if (shift.seatsLeft === 0) return { label: "Waitlist", tone: "warn" };
  return {
    label: `${shift.seatsLeft} seat${shift.seatsLeft === 1 ? "" : "s"} left`,
    tone: "neutral",
  };
}

function useTimezone(): string {
  return useCloud().workspace?.organization.timezone ?? "America/New_York";
}

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
                setProblem(caught instanceof Error ? caught.message : String(caught));
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

function ShiftRow({ shift, timezone }: { shift: ShiftView; timezone: string }) {
  const range = formatShiftRange(shift.startsAt, shift.endsAt, timezone);
  const status = shiftStatus(shift);
  return (
    <li>
      <Link to={`/shift/${shift.id}`} className={styles.shiftRow}>
        <span className={styles.shiftDate}>
          <strong>
            {new Date(shift.startsAt).toLocaleDateString("en-US", {
              day: "numeric",
              timeZone: timezone,
            })}
          </strong>
          <span>
            {new Date(shift.startsAt).toLocaleDateString("en-US", {
              month: "short",
              timeZone: timezone,
            })}
          </span>
        </span>
        <span className={styles.shiftCopy}>
          <span className={styles.shiftTitle}>{shift.title}</span>
          <span className={styles.shiftMeta}>
            {range.day} · {range.time}
          </span>
        </span>
        <span className={styles.shiftEnd}>
          <Pill tone={status.tone}>{status.label}</Pill>
          {shift.pending ? <span className={styles.queued}>Queued</span> : null}
        </span>
      </Link>
    </li>
  );
}

export function DiscoverScreen() {
  const { view } = useCloud();
  const timezone = useTimezone();
  const [cause, setCause] = useState<string>("all");
  if (!view) return <p className={styles.loading}>Loading opportunities…</p>;

  const causes = [...new Set(view.upcoming.map((shift) => shift.cause).filter(Boolean))];
  const shifts = view.upcoming.filter(
    (shift) => shift.status === "scheduled" && (cause === "all" || shift.cause === cause),
  );
  const saved = new Set(view.savedOpportunityIds);

  return (
    <div className={styles.stack}>
      <PageTitle
        eyebrow="Discover"
        title="Give an hour. Change a day."
        body="Seats update from your organization's shared schedule."
      />
      <div className={styles.chips} role="group" aria-label="Filter by cause">
        <button
          type="button"
          className={[styles.chip, cause === "all" ? styles.chipActive : ""].join(" ")}
          onClick={() => setCause("all")}
        >
          All
        </button>
        {causes.map((entry) => (
          <button
            key={entry}
            type="button"
            className={[styles.chip, cause === entry ? styles.chipActive : ""].join(" ")}
            onClick={() => setCause(entry)}
          >
            {causeLabel(entry)}
          </button>
        ))}
      </div>

      {shifts.length === 0 ? (
        <Card>
          <EmptyState
            title="No open opportunities right now"
            body="New shifts appear here as soon as a coordinator publishes them."
          />
        </Card>
      ) : (
        <ul className={styles.list}>
          {shifts.map((shift) => {
            const range = formatShiftRange(shift.startsAt, shift.endsAt, timezone);
            return (
              <Card as="li" key={shift.id} className={styles.discoverCard}>
                <Link to={`/shift/${shift.id}`} className={styles.discoverLink}>
                  <div className={styles.discoverMedia}>
                    {shift.image ? (
                      <img src={shift.image} alt={shift.imageAlt} loading="lazy" />
                    ) : (
                      <span className={styles.mediaFallback} aria-hidden>
                        <Sparkles size={22} />
                      </span>
                    )}
                  </div>
                  <div className={styles.discoverBody}>
                    <p className={styles.eyebrow}>{causeLabel(shift.cause)}</p>
                    <h2>{shift.title}</h2>
                    <p className={styles.shiftMeta}>
                      {range.day} · {range.time}
                    </p>
                    <p className={styles.shiftMeta}>
                      <MapPin aria-hidden size={14} />{" "}
                      {shift.address || "Location shared on arrival"}
                    </p>
                    <div className={styles.discoverFoot}>
                      <Pill tone={shift.seatsLeft === 0 ? "warn" : "good"}>
                        {shift.seatsLeft === 0
                          ? "Waitlist open"
                          : `${shift.seatsLeft} of ${shift.capacity} seats left`}
                      </Pill>
                      {saved.has(shift.opportunityId) ? (
                        <Heart aria-label="Saved" size={16} className={styles.savedHeart} />
                      ) : null}
                    </div>
                  </div>
                </Link>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ShiftDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { view, queue, conflicts, pendingShiftIds, status } = useCloud();
  const timezone = useTimezone();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<CommandType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const shift = view?.shifts.find((entry) => entry.id === id);
  const conflict = conflicts.find((entry) => entry.entity === id);
  const pending = shift ? pendingShiftIds.includes(shift.id) : false;

  if (!view) return <p className={styles.loading}>Loading shift…</p>;
  if (!shift) {
    return (
      <Card>
        <EmptyState
          title="That shift is not on this device"
          body="It may have been removed, or it belongs to another organization."
        />
        <Button variant="secondary" onClick={() => navigate("/schedule")}>
          Back to schedule
        </Button>
      </Card>
    );
  }

  const range = formatShiftRange(shift.startsAt, shift.endsAt, timezone);
  const statusPill = shiftStatus(shift);

  async function run(command: CommandType, payload: Record<string, unknown>, note: string) {
    if (!shift || !view) return;
    setBusy(command);
    setProblem(null);
    setMessage(null);
    try {
      await queue(command, { shiftId: shift.id, volunteerId: view.volunteerId, ...payload });
      setMessage(note);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.stack}>
      <Link to="/discover" className={styles.back}>
        <ArrowLeft aria-hidden size={16} /> Back
      </Link>
      <header className={styles.detailHero}>
        {shift.image ? <img src={shift.image} alt={shift.imageAlt} /> : null}
        <div className={styles.detailHeroBody}>
          <Pill tone={statusPill.tone}>{statusPill.label}</Pill>
          <h1>{shift.title}</h1>
          <p className={styles.heroMeta}>
            <CalendarDays aria-hidden size={16} /> {range.day} · {range.time} · {range.duration}
          </p>
          <p className={styles.heroMeta}>
            <MapPin aria-hidden size={16} />{" "}
            {shift.address || "Location shared by your coordinator"}
          </p>
        </div>
      </header>

      {!status.online ? (
        <p className={styles.offlineNote}>
          You're offline. Anything you do here is saved on this device and checked by the server
          when you reconnect.
        </p>
      ) : null}

      {conflict ? (
        <Card className={styles.conflictCard}>
          <TriangleAlert aria-hidden size={19} />
          <div>
            <p className={styles.cautionTitle}>The server did not accept that change</p>
            <p className={styles.cautionBody}>{conflict.message}</p>
            <Link to="/settings" className={styles.cautionLink}>
              Review in sync settings
            </Link>
          </div>
        </Card>
      ) : null}

      {message ? <p className={styles.success}>{message}</p> : null}
      {problem ? <p className={styles.error}>{problem}</p> : null}
      {pending ? (
        <p className={styles.queuedNote}>
          <TriangleAlert aria-hidden size={15} /> Saved on this device. It will send when you're
          online.
        </p>
      ) : null}

      <Card>
        <h2 className={styles.cardTitle}>About this shift</h2>
        <p className={styles.body}>
          {shift.description || "Your coordinator will share details on arrival."}
        </p>
        {shift.impactMetric ? (
          <p className={styles.impactLine}>
            <Sparkles aria-hidden size={16} /> {shift.impactMetric}
          </p>
        ) : null}
        {shift.requirements.length > 0 ? (
          <>
            <h3 className={styles.subhead}>Bring with you</h3>
            <ul className={styles.requirements}>
              {shift.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          </>
        ) : null}
        {shift.roles.length > 0 ? (
          <>
            <h3 className={styles.subhead}>Roles</h3>
            <ul className={styles.roles}>
              {shift.roles.map((role) => (
                <li key={role.name}>
                  <span>{role.name}</span>
                  <span className={styles.muted}>
                    {role.filled}/{role.required} filled
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      <Card className={styles.actionCard}>
        {shift.registration ? (
          <>
            <p className={styles.actionTitle}>
              <BadgeCheck aria-hidden size={18} /> You're registered
              {shift.registration.role ? ` as ${shift.registration.role}` : ""}.
            </p>
            <div className={styles.rowActions}>
              {shift.canCheckIn ? (
                <Button onClick={() => navigate(`/checkin/${shift.id}`)}>Check in</Button>
              ) : null}
              {shift.canCheckOut ? (
                <Button
                  variant="secondary"
                  loading={busy === "CHECK_OUT"}
                  onClick={() => void run("CHECK_OUT", {}, "Check-out saved.")}
                >
                  Check out
                </Button>
              ) : null}
              {shift.canCancel ? (
                <Button
                  variant="ghost"
                  loading={busy === "CANCEL_REGISTRATION"}
                  onClick={() =>
                    void run(
                      "CANCEL_REGISTRATION",
                      { reason: "Canceled from the volunteer app" },
                      "Your seat was released.",
                    )
                  }
                >
                  Cancel my seat
                </Button>
              ) : null}
            </div>
          </>
        ) : shift.waitlistPosition ? (
          <>
            <p className={styles.actionTitle}>
              You're number {shift.waitlistPosition} on the waitlist. We'll notify you if a seat
              opens.
            </p>
            <Button
              variant="ghost"
              loading={busy === "CANCEL_REGISTRATION"}
              onClick={() =>
                void run(
                  "CANCEL_REGISTRATION",
                  { reason: "Left the waitlist" },
                  "You left the waitlist.",
                )
              }
            >
              Leave waitlist
            </Button>
          </>
        ) : (
          <>
            <p className={styles.actionTitle}>
              {shift.seatsLeft === 0
                ? "Every seat is taken. Join the waitlist and we'll tell you first."
                : "Reserve your seat. The server confirms eligibility and capacity."}
            </p>
            <div className={styles.rowActions}>
              <Button
                loading={busy === "REGISTER_FOR_SHIFT"}
                onClick={() =>
                  void run(
                    "REGISTER_FOR_SHIFT",
                    { role: shift.roles[0]?.name ?? "", allowWaitlist: true },
                    shift.seatsLeft === 0
                      ? "You're on the waitlist."
                      : "Seat saved. It will sync when you're online.",
                  )
                }
              >
                {shift.seatsLeft === 0 ? "Join the waitlist" : "Register"}
              </Button>
              {shift.seatsLeft > 0 ? (
                <Button
                  variant="secondary"
                  loading={busy === "JOIN_WAITLIST"}
                  onClick={() =>
                    void run(
                      "JOIN_WAITLIST",
                      { role: shift.roles[0]?.name ?? "" },
                      "You joined the waitlist.",
                    )
                  }
                >
                  Waitlist instead
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Card>
    </div>
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

const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;
const PERIODS = [
  ["morning", "Morning"],
  ["afternoon", "Afternoon"],
  ["evening", "Evening"],
] as const;

export function ProfileScreen() {
  const { view, queue } = useCloud();
  const [name, setName] = useState(view?.name ?? "");
  const [phone, setPhone] = useState(view?.phone ?? "");
  const [interests, setInterests] = useState(view?.interests ?? "");
  const [skills, setSkills] = useState((view?.skills ?? []).join(", "));
  const [causes, setCauses] = useState<string[]>(view?.causes ?? []);
  const [availability, setAvailability] = useState<string[]>(view?.availability ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Initialize the draft once per volunteer. A background pull must not
  // overwrite words someone is still typing.
  if (view && loadedFor !== view.volunteerId) {
    setLoadedFor(view.volunteerId);
    setName(view.name);
    setPhone(view.phone);
    setInterests(view.interests);
    setSkills(view.skills.join(", "));
    setCauses(view.causes);
    setAvailability(view.availability);
  }

  if (!view) return <p className={styles.loading}>Loading profile…</p>;

  const toggle = (value: string) =>
    setAvailability((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );

  return (
    <div className={styles.stack}>
      <PageTitle eyebrow="Profile" title="What coordinators should know." />
      <Card className={styles.profileHead}>
        {view.photo ? (
          <img className={styles.avatarLarge} src={view.photo} alt="" />
        ) : (
          <span className={styles.avatarLarge} aria-hidden>
            {view.initials}
          </span>
        )}
        <div>
          <p className={styles.profileName}>{view.name}</p>
          <p className={styles.muted}>{view.email}</p>
          <p className={styles.muted}>
            Member since{" "}
            {view.memberSince
              ? new Date(view.memberSince).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })
              : "—"}
          </p>
        </div>
      </Card>

      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);
          setProblem(null);
          void queue(
            "SAVE_VOLUNTEER_PROFILE",
            {
              volunteerId: view.volunteerId,
              name: name.trim(),
              firstName: name.trim().split(/\s+/)[0] ?? "",
              phone: phone.trim(),
              interests: interests.trim(),
              causes,
              skills: skills
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
              availability,
              languages: [],
            },
            { [view.volunteerId]: view.rowVersion },
          )
            .then(() => setMessage("Profile saved. It will sync with the shared roster."))
            .catch((caught: unknown) =>
              setProblem(caught instanceof Error ? caught.message : String(caught)),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Card className={styles.formCard}>
          <div className={styles.formGrid}>
            <Field label="Full name">
              <Input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field label="Phone" hint="Only shared with your organization's coordinators.">
              <Input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(555) 010-2048"
              />
            </Field>
          </div>
          <Field label="Skills" hint="Separate with commas.">
            <Input value={skills} onChange={(event) => setSkills(event.target.value)} />
          </Field>
          <Field label="What drew you here?">
            <textarea
              className={styles.textarea}
              value={interests}
              onChange={(event) => setInterests(event.target.value)}
              rows={3}
            />
          </Field>
          <fieldset className={styles.fieldset}>
            <legend className={styles.fieldLabel}>Causes you care about</legend>
            <div className={styles.chips}>
              {Object.entries(CAUSE_LABEL).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={[styles.chip, causes.includes(value) ? styles.chipActive : ""].join(
                    " ",
                  )}
                  onClick={() =>
                    setCauses((current) =>
                      current.includes(value)
                        ? current.filter((entry) => entry !== value)
                        : [...current, value],
                    )
                  }
                  aria-pressed={causes.includes(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card className={styles.formCard}>
          <h2 className={styles.cardTitle}>When you're usually free</h2>
          <div className={styles.availability}>
            {DAYS.map(([day, label]) => (
              <div key={day} className={styles.availabilityRow}>
                <span>{label}</span>
                <div className={styles.availabilityOptions}>
                  {PERIODS.map(([period, periodLabel]) => {
                    const key = `${day}:${period}`;
                    const active = availability.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={[styles.slot, active ? styles.slotOn : ""].join(" ")}
                        aria-pressed={active}
                        onClick={() => toggle(key)}
                      >
                        {periodLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {message ? <p className={styles.success}>{message}</p> : null}
        {problem ? <p className={styles.error}>{problem}</p> : null}
        <Button type="submit" loading={busy}>
          Save profile
        </Button>
      </form>

      <Card>
        <h2 className={styles.cardTitle}>Credentials</h2>
        {view.credentials.length === 0 ? (
          <p className={styles.muted}>No credentials on file.</p>
        ) : (
          <ul className={styles.roles}>
            {view.credentials.map((credential) => (
              <li key={credential.id}>
                <span>{credential.name}</span>
                <Pill
                  tone={
                    credential.status === "current"
                      ? "good"
                      : credential.status === "expiring"
                        ? "warn"
                        : "bad"
                  }
                >
                  {credential.status === "current"
                    ? `Valid to ${credential.validThrough}`
                    : `${credential.status} · ${credential.validThrough}`}
                </Pill>
              </li>
            ))}
          </ul>
        )}
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
      setProblem(caught instanceof Error ? caught.message : String(caught));
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

export function SettingsScreen() {
  const {
    workspace,
    workspaces,
    selectWorkspace,
    signOut,
    status,
    syncNow,
    conflicts,
    dismissConflict,
    retryConflict,
    view,
  } = useCloud();
  return (
    <div className={styles.stack}>
      <PageTitle eyebrow="Settings" title="This device and your account." />

      <Card>
        <h2 className={styles.cardTitle}>Account</h2>
        <p className={styles.body}>{view?.email}</p>
        <p className={styles.muted}>{workspace?.organization.name}</p>
        <div className={styles.rowActions}>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Card>

      {workspaces.length > 1 ? (
        <Card>
          <h2 className={styles.cardTitle}>Organization</h2>
          <div className={styles.workspaceList}>
            {workspaces
              .filter((entry) => entry.status === "active")
              .map((entry) => (
                <button
                  key={entry.organizationId}
                  type="button"
                  className={[
                    styles.workspaceRow,
                    entry.organizationId === workspace?.organizationId
                      ? styles.workspaceActive
                      : "",
                  ].join(" ")}
                  onClick={() => void selectWorkspace(entry.organizationId)}
                >
                  <span>{entry.organization.name}</span>
                  <span className={styles.muted}>{entry.role}</span>
                </button>
              ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className={styles.cardTitle}>Sync</h2>
        <SyncBar status={status} onRetry={() => void syncNow()} />
        <dl className={styles.facts}>
          <div>
            <dt>Queued changes</dt>
            <dd>{status.pending}</dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{status.lastSyncedAt ? relativeTime(status.lastSyncedAt) : "Not yet"}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>{status.lastError ?? "None"}</dd>
          </div>
        </dl>
      </Card>

      {conflicts.length > 0 ? (
        <Card className={styles.conflictCard}>
          <h2 className={styles.cardTitle}>
            <TriangleAlert aria-hidden size={18} /> Needs your decision
          </h2>
          <p className={styles.body}>
            These changes were saved on this device but refused by the shared workspace. Nothing was
            overwritten.
          </p>
          <ul className={styles.conflictList}>
            {conflicts.map((conflict) => (
              <li key={conflict.id}>
                <p className={styles.noticeTitle}>{conflict.message}</p>
                <p className={styles.muted}>
                  {conflict.command.replaceAll("_", " ").toLowerCase()} · {conflict.code}
                </p>
                <div className={styles.rowActions}>
                  <Button variant="secondary" onClick={() => void dismissConflict(conflict.id)}>
                    Dismiss
                  </Button>
                  <Button variant="ghost" onClick={() => void retryConflict(conflict)}>
                    Try again
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <NotificationSettings />

      <p className={styles.finePrint}>
        CivicFlow Volunteer · synced workspace · data stays scoped to your account.
      </p>
    </div>
  );
}

function NotificationSettings() {
  const { workspace } = useCloud();
  const organizationId = workspace?.organizationId ?? null;
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>("unsupported");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    void Promise.all([loadPreferences(organizationId), loadPushConfig(), pushState()])
      .then(([loaded, capabilities, state]) => {
        if (!active) return;
        setPreferences(loaded);
        setConfig(capabilities);
        setPush(state);
        setLoadedFor(organizationId);
        setProblem(null);
      })
      .catch((caught: unknown) => {
        if (active) setProblem(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  if (!workspace || !organizationId) return null;
  if (!preferences || !config || loadedFor !== organizationId) {
    return (
      <Card>
        <h2 className={styles.cardTitle}>Reminders</h2>
        <p className={styles.muted}>Loading how this organization reaches you…</p>
      </Card>
    );
  }

  const update = <Key extends keyof NotificationPreferences>(
    key: Key,
    value: NotificationPreferences[Key],
  ) => setPreferences((current) => (current ? { ...current, [key]: value } : current));

  const pushReady = config.push.configured && push !== "unsupported" && push !== "blocked";
  const pushNote =
    push === "unsupported"
      ? "Install CivicFlow on your phone and open it from the Home Screen to receive push."
      : push === "blocked"
        ? "Notifications are blocked in this browser. Allow them in site settings, then reload."
        : push === "subscribed"
          ? "This device is registered. Turning push off removes it."
          : config.push.configured
            ? "Allow notifications when you save."
            : "Your organization has not enabled push yet.";

  async function save() {
    if (!organizationId || !preferences) return;
    if (Boolean(preferences.quietHoursStart) !== Boolean(preferences.quietHoursEnd)) {
      setProblem("Set both a quiet-hours start and end, or leave both blank.");
      return;
    }

    setBusy(true);
    setMessage(null);
    setProblem(null);
    try {
      if (preferences.push && push !== "subscribed") {
        await enablePush(organizationId, config?.push.publicKey ?? "");
      }
      if (!preferences.push && push === "subscribed") {
        await disablePush();
      }
      await savePreferences(organizationId, preferences);
      setPush(await pushState());
      setMessage("Notification settings saved. New reminders will use them.");
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className={styles.cardTitle}>Reminders</h2>
      <p className={styles.body}>
        Your organization decides what is worth a reminder. You decide how it reaches you.
      </p>

      <div className={styles.prefList}>
        <label className={styles.prefRow}>
          <input
            type="checkbox"
            aria-label="In the app"
            checked={preferences.inApp}
            onChange={(event) => update("inApp", event.target.checked)}
          />
          <span className={styles.prefCopy}>
            <span className={styles.prefTitle}>In the app</span>
            <span className={styles.fieldHint}>Always kept with your offline schedule.</span>
          </span>
        </label>

        <label className={styles.prefRow}>
          <input
            type="checkbox"
            aria-label="Push to this device"
            checked={preferences.push}
            disabled={!pushReady}
            onChange={(event) => update("push", event.target.checked)}
          />
          <span className={styles.prefCopy}>
            <span className={styles.prefTitle}>Push to this device</span>
            <span className={styles.fieldHint}>{pushNote}</span>
          </span>
        </label>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Remind me before a shift</span>
          <select
            className={styles.input}
            value={preferences.reminderMinutes}
            onChange={(event) => update("reminderMinutes", Number(event.target.value))}
          >
            <option value={60}>1 hour before</option>
            <option value={180}>3 hours before</option>
            <option value={1440}>1 day before</option>
            <option value={2880}>2 days before</option>
            <option value={10080}>1 week before</option>
          </select>
          <span className={styles.fieldHint}>
            Used for shift reminders. Your organization's rule is the fallback.
          </span>
        </label>

        <fieldset className={styles.fieldset}>
          <legend className={styles.fieldLabel}>Quiet hours</legend>
          <div className={styles.prefTime}>
            <label>
              From
              <input
                className={styles.input}
                type="time"
                value={preferences.quietHoursStart ?? ""}
                onChange={(event) => update("quietHoursStart", event.target.value || null)}
              />
            </label>
            <label>
              Until
              <input
                className={styles.input}
                type="time"
                value={preferences.quietHoursEnd ?? ""}
                onChange={(event) => update("quietHoursEnd", event.target.value || null)}
              />
            </label>
          </div>
          <span className={styles.fieldHint}>
            Push waits until quiet hours end. In-app reminders still arrive.
          </span>
        </fieldset>
      </div>

      {message ? <p className={styles.success}>{message}</p> : null}
      {problem ? <p className={styles.error}>{problem}</p> : null}

      <div className={styles.rowActions}>
        <Button loading={busy} onClick={() => void save()}>
          Save notification settings
        </Button>
        <InstallRow />
      </div>
    </Card>
  );
}

function InstallRow() {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <Button variant="ghost" onClick={() => void install()}>
      <Download aria-hidden size={16} /> Install this app
    </Button>
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
          Check-in opens an hour before the shift. The server enforces the window, so an early scan
          will be refused rather than silently accepted.
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
              .catch((caught: unknown) =>
                setProblem(caught instanceof Error ? caught.message : String(caught)),
              )
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
