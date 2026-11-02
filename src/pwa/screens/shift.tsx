import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, CalendarDays, MapPin, Sparkles, TriangleAlert } from "lucide-react";
import type { CommandType } from "../../lib/sync/protocol";
import { useCloud } from "../../lib/sync/provider";
import { formatShiftRange } from "../../lib/sync/views";
import { messageOf } from "../../lib/errors";
import { Button, Card, EmptyState, Pill } from "../ui";
import styles from "../pwa.module.css";
import { shiftStatus, useTimezone } from "./common";

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
      setProblem(messageOf(caught));
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
