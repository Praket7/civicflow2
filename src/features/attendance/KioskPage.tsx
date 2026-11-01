import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ScanQrCode, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar } from "../../components/ui";
import { t } from "../../lib/i18n";
import { QrScanner } from "../../components/checkin/QrScanner";
import { useCheckinWindow } from "../../lib/workspace/queries";
import { useWorkspace } from "../../lib/workspace/session";
import {
  formatDate,
  formatTime,
  getLiveEvent,
  rosterCounts,
  timeRange,
} from "../../lib/workspace/selectors";
import styles from "./Attendance.module.css";
import { messageOf } from "../../lib/errors";

function publicName(name: string): string {
  const parts = name.trim().split(" ");
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

type LiveEvent = NonNullable<ReturnType<typeof getLiveEvent>>;

/** Shows one shift, or says there is nothing to check into. */
export function KioskPage() {
  const { workspace, session } = useWorkspace();
  const event = getLiveEvent(session, workspace);
  if (!event) {
    return (
      <main className={styles.kiosk}>
        <section className={styles.kioskLeft}>
          <div className={styles.kioskTop}>
            <Link className={styles.kioskBrand} to="/coordinator/attendance">
              <span className={styles.kioskMark} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="25" height="25" focusable="false">
                  <path
                    d="M12 3 4.5 6.4v5.2c0 4.6 3.1 8.2 7.5 9.4 4.4-1.2 7.5-4.8 7.5-9.4V6.4L12 3Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              CivicFlow
            </Link>
            <p className={styles.kioskEyebrow}>{t("Volunteer check-in")}</p>
          </div>
          <div className={styles.kioskStation}>
            <h1 className={styles.kioskTitle} id="kiosk-title">
              {t("Nothing is scheduled yet.")}
            </h1>
            <p className={styles.kioskSub}>{t("Publish a shift to start filling roles.")}</p>
          </div>
        </section>
      </main>
    );
  }
  return <KioskBody event={event} />;
}

function KioskBody({ event }: { event: LiveEvent }) {
  const { workspace, actions } = useWorkspace();
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [eventCode, setEventCode] = useState<string | null>(null);
  const [scannedToken, setScannedToken] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const { data: checkinWindow } = useCheckinWindow(event.shift.id);
  const codeInput = useRef<HTMLInputElement>(null);
  const title = event.opportunity?.title ?? "Pantry Setup";
  const roster = event.roster;
  const waiting = roster.filter((row) => row.status === "expected" || row.status === "confirmed");
  const counts = rosterCounts(roster);
  const arrived = counts.checkedIn + counts.completed;
  const checkedRows = roster.filter(
    (row) => row.status === "checked_in" || row.status === "completed",
  );
  const percent =
    event.shift.capacity === 0 ? 0 : Math.round((arrived / event.shift.capacity) * 100);

  const selectedRow = roster.find((row) => row.volunteer.id === selected);

  useEffect(() => {
    let active = true;
    actions
      .getCheckinCode(event.shift.id)
      .then((code) => {
        if (active) setEventCode(code.code);
      })
      .catch((caught: unknown) => {
        if (active) setError(messageOf(caught));
      });
    return () => {
      active = false;
    };
  }, [actions, event.shift.id]);

  function submit(event_: FormEvent) {
    event_.preventDefault();
    setSuccess("");
    if (checkinWindow && !checkinWindow.canSelfCheckIn) {
      setError(
        checkinWindow.status === "not_open"
          ? "Check-in is not open yet. It opens 30 minutes before the shift starts."
          : "Arrival check-in has closed. Ask the shift lead for a manual check-in so your hours stay accurate.",
      );
      return;
    }
    if (!scannedToken && (!eventCode || code !== eventCode)) {
      setError("That code doesn't match today's event. Ask the shift lead for the six-digit code.");
      return;
    }
    if (!selectedRow) {
      setError("Select your name from today's expected list first.");
      return;
    }
    if (selectedRow.status === "checked_in" || selectedRow.status === "completed") {
      setError(`${publicName(selectedRow.volunteer.name)} is already checked in.`);
      return;
    }
    actions
      .checkIn(event.shift.id, selectedRow.volunteer.id, scannedToken ?? code)
      .then(() => {
        setError("");
        setSuccess(`${publicName(selectedRow.volunteer.name)}, you're checked in. Welcome!`);
        setCode("");
        setSelected("");
        setScannedToken(null);
      })
      .catch((caught: unknown) => {
        setScannedToken(null);
        setError(messageOf(caught));
      });
  }

  function handleScan(payload: string) {
    setScannerOpen(false);
    setError("");
    setSuccess("");
    const token = payload.startsWith("civicflow://checkin/")
      ? payload
      : payload.trim().startsWith("civicflow://")
        ? payload.trim()
        : null;
    if (!token) {
      setError("That QR code is not a CivicFlow check-in code.");
      return;
    }
    setScannedToken(token);
    setSuccess("QR code read. Choose your name, then press Check in.");
    window.setTimeout(() => codeInput.current?.focus(), 0);
  }

  return (
    <main className={styles.kiosk}>
      <section className={styles.kioskLeft} aria-labelledby="kiosk-title">
        <img className={styles.kioskPhoto} src="/media/hero-community.jpg" alt="" />
        <div className={styles.kioskScrim} aria-hidden="true" />
        <div className={styles.kioskTop}>
          <Link className={styles.kioskBrand} to="/coordinator/attendance">
            <span className={styles.kioskMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="25" height="25" focusable="false">
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
            CivicFlow
          </Link>
          <span className={styles.kioskStation}>{`${workspace.organization.name} · ${title}`}</span>
        </div>

        <div className={styles.kioskEntry}>
          <p className={styles.kioskEyebrow}>Volunteer check-in</p>
          <h1 className={styles.kioskTitle} id="kiosk-title">
            Check in
          </h1>
          <p className={styles.kioskSub}>
            {title} · {timeRange(event.shift.startsAt, event.shift.endsAt)}. Enter the six-digit
            event code from the check-in table.
          </p>

          <form className={styles.kioskForm} onSubmit={submit}>
            <fieldset className={styles.kioskFieldset}>
              <div className={styles.kioskCodeHead}>
                <span className={styles.kioskLabel}>Event code</span>
                <button
                  type="button"
                  className={styles.kioskScan}
                  onClick={() => setScannerOpen(true)}
                >
                  <ScanQrCode size={14} aria-hidden="true" />
                  Scan QR code
                </button>
              </div>
              <div
                className={styles.kioskCodeRow}
                onClick={() => codeInput.current?.focus()}
                role="presentation"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <span
                    className={styles.kioskCodeCell}
                    data-filled={index < code.length ? "true" : undefined}
                    key={index}
                    aria-hidden="true"
                  >
                    {code[index] ?? ""}
                  </span>
                ))}
                <input
                  ref={codeInput}
                  id="kiosk-code"
                  className={styles.kioskCodeInput}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event_) => {
                    setCode(event_.target.value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  aria-label="Six-digit event code"
                  aria-describedby="kiosk-code-help"
                />
              </div>
            </fieldset>

            <label className={styles.kioskLabel} htmlFor="kiosk-person">
              Your name
            </label>
            <select
              id="kiosk-person"
              className={styles.kioskSelect}
              value={selected}
              onChange={(event_) => {
                setSelected(event_.target.value);
                setError("");
              }}
            >
              <option value="">Select your name…</option>
              {waiting.map((row) => (
                <option key={row.volunteer.id} value={row.volunteer.id}>
                  {publicName(row.volunteer.name)}
                </option>
              ))}
            </select>

            <p className={styles.kioskHelp} id="kiosk-code-help">
              {scannedToken ? (
                <>
                  QR code read. Choose your name below. The token is verified by the local Rust core
                  before attendance is recorded.
                </>
              ) : eventCode ? (
                <>
                  Demo event code: <strong>{eventCode}</strong> · The kiosk works offline and writes
                  to the local attendance record.
                </>
              ) : (
                "Loading today's event code…"
              )}
            </p>
            {error ? (
              <p className={styles.kioskError} role="alert">
                {error}
              </p>
            ) : null}
            {success ? (
              <p className={styles.kioskSuccess} role="status">
                <Check size={14} aria-hidden="true" /> {success}
              </p>
            ) : null}

            <div className={styles.kioskActions}>
              <button type="submit" className={styles.kioskPrimary}>
                Check in <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </form>

          <div className={styles.kioskTrust}>
            <span>
              <ShieldCheck size={13} aria-hidden="true" /> Names are shortened on this public screen
            </span>
            <Link to="/coordinator/attendance">Coordinator view</Link>
            <Link to="/coordinator/attendance">
              <ArrowLeft size={12} aria-hidden="true" /> Exit kiosk
            </Link>
          </div>
        </div>
      </section>

      {scannerOpen ? <QrScanner onScan={handleScan} onClose={() => setScannerOpen(false)} /> : null}

      <aside className={styles.kioskRight} aria-label="Live attendance">
        <div className={styles.kioskCard}>
          <header className={styles.kioskCardHead}>
            <h2>{title}</h2>
            <p>
              <CalendarDays size={14} aria-hidden="true" />
              {formatDate(event.shift.startsAt)} ·{" "}
              {timeRange(event.shift.startsAt, event.shift.endsAt)}
            </p>
          </header>

          <div className={styles.kioskLedger}>
            <p className={styles.kioskBig}>
              <strong>{arrived}</strong>
              <span>of {event.shift.capacity} checked in</span>
            </p>
            <div
              className={styles.kioskTrack}
              role="img"
              aria-label={`${arrived} volunteers checked in, ${percent} percent of seats`}
            >
              <span style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
            <dl className={styles.kioskCounts}>
              <div>
                <dt>Expected</dt>
                <dd>{counts.expected}</dd>
              </div>
              <div>
                <dt>Missing</dt>
                <dd>{counts.noShow}</dd>
              </div>
              <div>
                <dt>Seats left</dt>
                <dd>{Math.max(0, event.shift.capacity - arrived)}</dd>
              </div>
            </dl>
          </div>

          <section className={styles.kioskRecent}>
            <h3>Recent check-ins</h3>
            {checkedRows.length === 0 ? (
              <p className={styles.kioskEmpty}>No arrivals yet. Be the first to check in.</p>
            ) : (
              <ul>
                {checkedRows.slice(0, 4).map((row) => (
                  <li key={row.volunteer.id}>
                    <Avatar initials={row.volunteer.initials} tone={row.volunteer.tone} size={28} />
                    <span className={styles.kioskRecentName}>{publicName(row.volunteer.name)}</span>
                    <span className={styles.kioskRecentTime}>
                      {row.checkedInAt ? formatTime(row.checkedInAt) : "now"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <footer className={styles.kioskCardFoot}>
            <span className={styles.kioskLiveDot} aria-hidden="true" />
            Event code rotates every 15 minutes · Offline check-ins sync to the roster
          </footer>
        </div>
      </aside>
    </main>
  );
}
