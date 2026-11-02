import { useState } from "react";
import { Link } from "react-router-dom";
import { Heart, MapPin, Sparkles } from "lucide-react";
import { useCloud } from "../../lib/sync/provider";
import { formatShiftRange } from "../../lib/sync/views";
import { Card, EmptyState, PageTitle, Pill } from "../ui";
import styles from "../pwa.module.css";
import { causeLabel, useTimezone } from "./common";

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
