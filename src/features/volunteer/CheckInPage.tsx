import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { CheckInQr } from "../../components/checkin/CheckInQr";
import { Avatar, Button, ButtonLink } from "../../components/ui";
import { t } from "../../lib/i18n";
import {
  currentVolunteer,
  formatTime,
  getLiveEvent,
  timeRange,
} from "../../lib/workspace/selectors";
import { useCheckinWindow } from "../../lib/workspace/queries";
import { useWorkspace } from "../../lib/workspace/session";
import type { CheckinStatus } from "../../types/domain";
import styles from "./CheckInPage.module.css";
import { messageOf } from "../../lib/errors";

const CODE_LENGTH = 6;

function emptyDigits(): string[] {
  return Array.from({ length: CODE_LENGTH }, () => "");
}

const WINDOW_COPY: Record<CheckinStatus, string> = {
  open: "Check-in is open. Enter the code posted at the check-in table.",
  not_open: "Check-in is not open yet. The door code activates 30 minutes before the shift starts.",
  closed:
    "Arrival check-in has closed. Ask the shift lead for a manual check-in so your hours stay accurate.",
};

/** Shown when the signed-in volunteer's workspace has no shift to check into. */
function NoEventPanel() {
  return (
    <div className={styles.world} data-theme="light">
      <div className={styles.panelWrap}>
        <section className={styles.panel}>
          <h1 className={styles.title}>No event is open right now</h1>
          <p className={styles.missingCopy}>
            The next check-in window appears here 30 minutes before a shift begins.{" "}
            <Link to="/volunteer/schedule">View my schedule</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}

type LiveEvent = NonNullable<ReturnType<typeof getLiveEvent>>;

export function CheckInPage() {
  const { workspace, session } = useWorkspace();
  const liveEvent = getLiveEvent(session, workspace);
  if (!liveEvent) return <NoEventPanel />;
  return <CheckInBody liveEvent={liveEvent} />;
}

function CheckInBody({ liveEvent }: { liveEvent: LiveEvent }) {
  const { workspace, session, actions } = useWorkspace();
  const volunteer = currentVolunteer(workspace);
  const { shift, opportunity } = liveEvent;

  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [error, setError] = useState("");
  const [codeAccepted, setCodeAccepted] = useState(false);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const { data: checkinWindow } = useCheckinWindow(shift.id);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  // The QR carries a token, never the printed six-digit code.
  useEffect(() => {
    let active = true;
    actions
      .getCheckinCode(shift.id)
      .then((credential) => {
        if (active) setQrPayload(credential.payload || null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [actions, shift.id]);

  if (!opportunity) return <NoEventPanel />;

  const now = parseISO(workspace.now);
  const windowState = checkinWindow?.status ?? null;
  const isOpen = windowState === "open";

  // A derived "checked in" status can carry a future timestamp; count it only
  // once that time has passed.
  const sessionAttendance = session.attendance[shift.id] ?? [];
  const roster = liveEvent.roster.map((row) => {
    const saved = sessionAttendance.find((entry) => entry.volunteerId === row.volunteer.id);
    const recordedAt = saved?.checkedInAt ?? row.checkedInAt;
    const hasArrived =
      (row.status === "checked_in" || row.status === "completed") &&
      Boolean(recordedAt) &&
      new Date(recordedAt as string).getTime() <= now.getTime();
    return { ...row, saved, recordedAt, hasArrived };
  });

  const myRow = roster.find((row) => row.volunteer.id === volunteer.id);
  const alreadyCheckedIn = Boolean(myRow?.hasArrived);
  const arrivals = roster
    .filter((row) => row.hasArrived)
    .sort((a, b) => (b.recordedAt ?? "").localeCompare(a.recordedAt ?? ""));
  const expected = roster.filter((row) => !row.hasArrived && row.status !== "no_show").length;
  const checkedInCount = arrivals.length;
  const capacity = shift.capacity;
  const percent = capacity === 0 ? 0 : Math.round((checkedInCount / capacity) * 100);
  const canSubmit =
    isOpen && Boolean(myRow) && !alreadyCheckedIn && digits.every((digit) => digit.length === 1);

  function focusInput(index: number) {
    const bounded = Math.max(0, Math.min(CODE_LENGTH - 1, index));
    inputs.current[bounded]?.focus();
  }

  function distribute(start: number, raw: string) {
    const cleaned = raw.replace(/\D/g, "").slice(0, CODE_LENGTH - start);
    if (cleaned.length === 0) return;
    setError("");
    setDigits((current) => {
      const next = [...current];
      cleaned.split("").forEach((digit, offset) => {
        next[start + offset] = digit;
      });
      return next;
    });
    focusInput(start + cleaned.length);
  }

  function handleChange(index: number, raw: string) {
    const cleaned = raw.replace(/\D/g, "");
    if (cleaned.length === 0) {
      setDigits((current) => {
        const next = [...current];
        next[index] = "";
        return next;
      });
      return;
    }
    if (cleaned.length > 1) {
      distribute(index, cleaned);
      return;
    }
    setError("");
    setDigits((current) => {
      const next = [...current];
      next[index] = cleaned;
      return next;
    });
    focusInput(index + 1);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && digits[index] === "") {
      event.preventDefault();
      setDigits((current) => {
        const next = [...current];
        next[Math.max(0, index - 1)] = "";
        return next;
      });
      focusInput(index - 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusInput(index - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusInput(index + 1);
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    if (!/\d/.test(pasted)) return;
    event.preventDefault();
    distribute(index, pasted);
  }

  function resetCode() {
    setDigits(emptyDigits());
    window.requestAnimationFrame(() => focusInput(0));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!myRow) {
      setError(
        t("You are not on today's roster. Ask the shift lead to add you before checking in."),
      );
      return;
    }
    if (!checkinWindow) return;
    if (!isOpen) {
      setError(t(WINDOW_COPY[checkinWindow.status]));
      return;
    }
    // The workspace, not this screen, decides whether the code is live. Sending
    // what the volunteer typed also keeps the demo hint from becoming the gate.
    setError("");
    actions
      .checkIn(shift.id, volunteer.id, digits.join(""))
      .then(() => setCodeAccepted(true))
      .catch((caught: unknown) => {
        setError(messageOf(caught));
        resetCode();
      });
  }

  return (
    <div className={styles.world} data-theme="light">
      <div className={styles.photo} aria-hidden="true" />
      <div className={styles.photoShade} aria-hidden="true" />

      <div className={styles.panelWrap}>
        <section className={styles.panel} aria-labelledby="checkin-title">
          <div className={styles.panelInner}>
            <p className={styles.panelKicker}>Volunteer check-in</p>

            <p className={styles.eventLine}>
              {workspace.organization.name}
              <span aria-hidden="true"> · </span>
              {opportunity.title}
            </p>

            {alreadyCheckedIn && myRow ? (
              <div className={styles.success}>
                <span className={styles.successIcon} aria-hidden="true">
                  <CheckCircle2 size={44} strokeWidth={1.9} />
                </span>
                <p className={styles.successKicker}>
                  {t(codeAccepted ? "Code accepted" : "Attendance confirmed")}
                </p>
                <h1 className={styles.successTitle} id="checkin-title">
                  You&rsquo;re checked in.
                </h1>
                <p className={styles.successCopy}>
                  {t(
                    "{name} · {program}. The shift lead can see you have arrived, and your service record will use this check-in time.",
                    { name: volunteer.name, program: opportunity.title },
                  )}
                </p>
                <dl className={styles.successFacts}>
                  <div>
                    <dt>Checked in</dt>
                    <dd>{myRow.recordedAt ? formatTime(myRow.recordedAt) : t("Recorded")}</dd>
                  </div>
                  <div>
                    <dt>Check-out by</dt>
                    <dd>{formatTime(shift.endsAt)}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{myRow.role}</dd>
                  </div>
                </dl>
                <p className={styles.successNote} role="status" aria-live="polite">
                  {t(
                    codeAccepted
                      ? "Check-in recorded. Your hours stay pending until the coordinator reviews them."
                      : "You were already checked in for this shift. Nothing else is needed right now.",
                  )}
                </p>
                <div className={styles.successActions}>
                  <ButtonLink
                    to="/volunteer/schedule"
                    variant="primary"
                    icon={<CalendarDays size={14} />}
                  >
                    View my schedule
                  </ButtonLink>
                  <ButtonLink to="/volunteer/hours" variant="secondary">
                    See my hours
                  </ButtonLink>
                </div>
              </div>
            ) : (
              <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <h1 className={styles.title} id="checkin-title">
                  Check in
                </h1>
                <p className={styles.subtitle}>Enter the six-digit code from the check-in table.</p>

                <CheckInQr payload={qrPayload} />

                <div className={styles.digitRow} role="group" aria-label="Six-digit event code">
                  {digits.map((digit, index) => (
                    <input
                      key={index}
                      ref={(node) => {
                        inputs.current[index] = node;
                      }}
                      className={styles.digit}
                      value={digit}
                      inputMode="numeric"
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      pattern="[0-9]*"
                      maxLength={1}
                      aria-label={t("Digit {index} of {count}", {
                        index: index + 1,
                        count: CODE_LENGTH,
                      })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={`event-code-hint${error ? " event-code-error" : ""}`}
                      onChange={(event) => handleChange(index, event.target.value)}
                      onKeyDown={(event) => handleKeyDown(index, event)}
                      onPaste={(event) => handlePaste(index, event)}
                    />
                  ))}
                </div>

                <p className={styles.codeHint} id="event-code-hint">
                  {t("Event code rotates every 15 minutes · Offline check-ins sync to the roster")}
                </p>

                {error ? (
                  <p className={styles.error} id="event-code-error" role="alert">
                    <AlertCircle size={15} aria-hidden="true" />
                    {error}
                  </p>
                ) : null}

                {checkinWindow ? (
                  <p className={styles.windowNote} data-state={checkinWindow.status}>
                    <ShieldCheck size={14} aria-hidden="true" />
                    {t(WINDOW_COPY[checkinWindow.status])}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  size="large"
                  className={styles.submit}
                  disabled={!canSubmit}
                  icon={<ArrowRight size={17} />}
                >
                  Check in
                </Button>

                <p className={styles.helpNote}>
                  No phone, or the code will not take? Ask the shift lead for a manual check-in.
                  They can add you from the live roster.
                </p>
              </form>
            )}

            {checkinWindow ? (
              <p className={styles.windowStatus} data-state={checkinWindow.status}>
                <Clock3 size={13} aria-hidden="true" />
                {isOpen
                  ? t("Check-in closes {time}", { time: formatTime(checkinWindow.closesAt) })
                  : checkinWindow.status === "not_open"
                    ? t("Opens {time}", { time: formatTime(checkinWindow.opensAt) })
                    : t("Check-in closed")}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <aside className={styles.livePanel} aria-label="Live attendance for this event">
        <div className={styles.when}>
          <span>{format(parseISO(shift.startsAt), "EEEE, MMMM d, yyyy")}</span>
          <strong>{timeRange(shift.startsAt, shift.endsAt)}</strong>
        </div>

        <div className={styles.liveLedger}>
          <p className={styles.livePrimary}>
            <strong>{checkedInCount}</strong>
            <span>{t("of {count} checked in", { count: capacity })}</span>
          </p>
          <div
            className={styles.liveTrack}
            role="img"
            aria-label={t("{checked} of {capacity} seats checked in", {
              checked: checkedInCount,
              capacity,
            })}
          >
            <span style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
          <dl className={styles.liveCounts}>
            <div>
              <dt>Expected</dt>
              <dd>{expected}</dd>
            </div>
            <div>
              <dt>Checked in</dt>
              <dd>{checkedInCount}</dd>
            </div>
            <div>
              <dt>{t("Seats left")}</dt>
              <dd>{Math.max(0, capacity - checkedInCount)}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.arrivalsCard}>
          <div className={styles.arrivalsHead}>
            <h2>Recent check-ins</h2>
            <span>
              <span className={styles.liveDot} aria-hidden="true" />
              Live
            </span>
          </div>
          {arrivals.length === 0 ? (
            <p className={styles.arrivalsEmpty}>
              No one has checked in yet. Doors open 30 minutes before the shift.
            </p>
          ) : (
            <ul className={styles.arrivalList}>
              {arrivals.slice(0, 3).map((row) => (
                <li key={row.volunteer.id} className={styles.arrival}>
                  <Avatar
                    initials={row.volunteer.initials}
                    tone={row.volunteer.tone}
                    size={32}
                    label={row.volunteer.name}
                  />
                  <div className={styles.arrivalCopy}>
                    <span className={styles.arrivalName}>{row.volunteer.name}</span>
                    <span className={styles.arrivalMeta}>
                      Checked in{row.recordedAt ? ` · ${formatTime(row.recordedAt)}` : ""}
                    </span>
                  </div>
                  <CheckCircle2 className={styles.arrivalCheck} size={17} aria-label="Checked in" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
