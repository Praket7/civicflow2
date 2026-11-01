import { Badge, Card, SectionHeader } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useCredentialReadiness, useEngagementMetrics } from "../../lib/workspace/queries";
import styles from "./DecisionReadout.module.css";
import { messageOf } from "../../lib/errors";

interface Readout {
  label: string;
  value: string;
  detail: string;
}

interface ReadoutGroup {
  title: string;
  subtitle: string;
  rows: Readout[];
}

/**
 * Each number answers a decision and carries the definition it was computed
 * with.
 */
export function DecisionReadoutCard() {
  const { data: engagement, error: engagementError } = useEngagementMetrics();
  const { data: readiness, error: readinessError } = useCredentialReadiness();
  const error = engagementError ?? readinessError;

  if (!engagement || !readiness) {
    return error ? (
      <Card className={styles.card} ariaLabel={t("Decision readouts")}>
        <SectionHeader title={t("Decision readouts")} subtitle={t("Reading the record…")} />
        <p className={styles.error} role="alert">
          {messageOf(error)}
        </p>
      </Card>
    ) : null;
  }

  const groups: ReadoutGroup[] = [
    {
      title: t("Coverage decisions"),
      subtitle: t("Whether the roster held, and what it cost when it did not."),
      rows: [
        {
          label: t("Late cancellations"),
          value: `${engagement.lateCancellationRate}%`,
          detail: t("Canceled within 48 hours of the shift"),
        },
        {
          label: t("Waitlist promotions"),
          value: String(engagement.waitlistPromotions),
          detail: t("Seats filled from the waiting line"),
        },
        {
          label: t("Promotion success"),
          value: `${engagement.waitlistPromotionRate}%`,
          detail: t("Promotions that completed the shift"),
        },
        {
          label: t("Average sign-up lead"),
          value: t("{count} days", { count: engagement.averageLeadDays }),
          detail: t("How far ahead volunteers commit"),
        },
      ],
    },
    {
      title: t("Volunteer engagement"),
      subtitle: t("Who started, who came back, and who stopped."),
      rows: [
        {
          label: t("New volunteers"),
          value: String(engagement.newVolunteers),
          detail: t("Joined in the last 90 days"),
        },
        {
          label: t("Returned within 30 days"),
          value: `${engagement.return30}%`,
          detail: t("Served a second shift in a month"),
        },
        {
          label: t("Returned within 60 days"),
          value: `${engagement.return60}%`,
          detail: t("Served again within two months"),
        },
        {
          label: t("Returned within 90 days"),
          value: `${engagement.return90}%`,
          detail: t("Served again within a quarter"),
        },
        {
          label: t("Inactive volunteers"),
          value: String(engagement.inactiveVolunteers),
          detail: t("No completed shift in 90 days"),
        },
        {
          label: t("Completed shifts"),
          value: String(engagement.completedShifts),
          detail: t("Shifts with recorded check-in and check-out"),
        },
        {
          label: t("No-show rate"),
          value: `${engagement.noShowRate}%`,
          detail: t("Registered volunteers who did not arrive"),
        },
      ],
    },
    {
      title: t("Credential readiness"),
      subtitle: t("What the next shift can be staffed with today."),
      rows: [
        {
          label: t("Current"),
          value: String(readiness.current),
          detail: t("Credentials valid today"),
        },
        {
          label: t("Expiring in 30 days"),
          value: String(readiness.expiringSoon),
          detail: t("Renew before the next assignment"),
        },
        {
          label: t("Expired"),
          value: String(readiness.expired),
          detail: t("No longer valid for a required role"),
        },
        {
          label: t("Future shifts at risk"),
          value: String(readiness.assignmentsAtRisk),
          detail: t("Assignments whose credential lapses first"),
        },
      ],
    },
  ];

  return (
    <Card className={styles.card} ariaLabel={t("Decision readouts")}>
      <SectionHeader
        title={t("Decision readouts")}
        subtitle={t("Coverage, engagement, and credential readiness from the service record.")}
      />
      <div className={styles.groups}>
        {groups.map((group) => (
          <section key={group.title} className={styles.group} aria-label={group.title}>
            <h3 className={styles.groupTitle}>{group.title}</h3>
            <p className={styles.groupCopy}>{group.subtitle}</p>
            <ul className={styles.rows}>
              {group.rows.map((row) => (
                <li key={row.label} className={styles.row}>
                  <span className={styles.rowText}>
                    <span className={styles.rowLabel}>{row.label}</span>
                    <span className={styles.rowDetail}>{row.detail}</span>
                  </span>
                  <Badge tone="neutral">{row.value}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
