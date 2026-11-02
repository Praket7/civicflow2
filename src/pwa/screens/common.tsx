import { Link } from "react-router-dom";
import { useCloud } from "../../lib/sync/provider";
import { formatShiftRange, type ShiftView } from "../../lib/sync/views";
import { Pill } from "../ui";
import styles from "../pwa.module.css";

export const CAUSE_LABEL: Record<string, string> = {
  food: "Food security",
  education: "Education",
  environment: "Environment",
  health: "Health",
  community: "Community",
  animals: "Animals",
};

export function causeLabel(cause: string): string {
  return CAUSE_LABEL[cause] ?? "Community";
}

export function shiftStatus(shift: ShiftView): {
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

export function useTimezone(): string {
  return useCloud().workspace?.organization.timezone ?? "America/New_York";
}

export function ShiftRow({ shift, timezone }: { shift: ShiftView; timezone: string }) {
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
