import { Award, Flag } from "lucide-react";
import { Badge, Card, SectionHeader } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useVolunteerInsight } from "../../lib/workspace/queries";
import styles from "./MilestoneCard.module.css";
import { messageOf } from "../../lib/errors";

/** A few milestones and the next one; no leaderboard. */
export function MilestoneCard({
  volunteerId,
  organization,
}: {
  volunteerId: string;
  organization: string;
}) {
  const { data: insight, error } = useVolunteerInsight(volunteerId);
  const earned = insight?.milestones.filter((milestone) => milestone.earned).length ?? 0;

  return (
    <Card className={styles.card} ariaLabel={t("Recognition milestones")}>
      <SectionHeader
        title="Recognition milestones"
        subtitle={t("Verified hours, completed shifts, and years of service as they are recorded.")}
        action={
          <Badge tone={earned > 0 ? "green" : "neutral"} dot>
            {t("{count} reached", { count: earned })}
          </Badge>
        }
      />
      {error ? (
        <p className={styles.error} role="alert">
          {messageOf(error)}
        </p>
      ) : null}
      {!insight ? null : (
        <>
          <p className={styles.totals}>
            {t("{hours} verified hours · {shifts} completed shifts", {
              hours: insight.verifiedHours,
              shifts: insight.completedShifts,
            })}
          </p>
          <ul className={styles.list}>
            {insight.milestones.map((milestone) => (
              <li
                key={milestone.key}
                className={`${styles.row} ${milestone.earned ? styles.rowEarned : ""}`}
              >
                <span className={styles.mark} aria-hidden="true">
                  {milestone.earned ? <Award size={14} /> : <Flag size={14} />}
                </span>
                <span className={styles.label}>{milestone.label}</span>
                <span className={styles.state}>
                  {milestone.earned ? t("Reached") : milestone.remaining}
                </span>
              </li>
            ))}
          </ul>
          {insight.next ? (
            <p className={styles.next}>{t("Next: {milestone}", { milestone: insight.next })}</p>
          ) : null}
        </>
      )}
      <p className={styles.note}>
        {t(
          "Milestones are recognition, not a score: {name} counts verified hours and completed shifts from the service record.",
          { name: organization },
        )}
      </p>
    </Card>
  );
}
