import { Fragment, type ReactNode } from "react";
import { t } from "../../lib/i18n";
import type { SharedReport } from "../../lib/sync/sharedReports";
import { formatHours, formatPacketMonth } from "./reportFormat";
import styles from "./shared.module.css";

/**
 * The funder packet is one document with two audiences: the in-app preview and
 * the printed PDF. Both render these same sections, so a change to a heading or
 * a column cannot land on paper without also appearing in the preview.
 */

export interface FunderPacketProps {
  report: SharedReport;
  organizationName: string;
  rangeLabel: string;
  selectedProgramTitle: string;
  revision: number;
  pendingLabel: string;
}

export interface PacketSection {
  key: string;
  node: ReactNode;
}

export function funderPacketSections({
  report,
  organizationName,
  rangeLabel,
  selectedProgramTitle,
  revision,
  pendingLabel,
}: FunderPacketProps): PacketSection[] {
  const noShowLabel = `${report.totals.noShows} no-show${report.totals.noShows === 1 ? "" : "s"}`;
  const averageSessionMinutes =
    report.totals.shiftsCompleted > 0
      ? report.totals.verifiedMinutes / report.totals.shiftsCompleted
      : 0;
  const packetMonths = report.months.filter(
    (month) => month.verifiedMinutes > 0 || month.pendingMinutes > 0,
  );

  return [
    {
      key: "header",
      node: (
        <header className={styles.packetHeader} data-packet-section="header">
          <span className={styles.packetBrand}>CivicFlow</span>
          <span className={styles.packetHeaderMeta}>
            Funder packet
            <span aria-hidden="true"> · </span>
            {rangeLabel}
          </span>
        </header>
      ),
    },
    {
      key: "cover",
      node: (
        <section className={styles.packetCover} data-packet-section="cover">
          <p className={styles.packetOrg}>{organizationName}</p>
          <h2 className={styles.packetTitle}>Impact report</h2>
          <p className={styles.packetPeriod}>{rangeLabel}</p>
          <p className={styles.packetKicker}>Verified service</p>

          <div className={styles.packetSummary}>
            <div className={styles.packetHeadline}>
              <span className={styles.packetHeadlineValue} data-testid="packet-verified-hours">
                {formatHours(report.totals.verifiedMinutes)}
              </span>
              <span className={styles.packetHeadlineLabel}>Verified hours</span>
            </div>
            <dl className={styles.packetMetrics}>
              <div>
                <dt>Volunteers</dt>
                <dd>{report.totals.volunteers}</dd>
              </div>
              <div>
                <dt>New volunteers</dt>
                <dd>{report.totals.newVolunteers}</dd>
              </div>
              <div>
                <dt>Shifts completed</dt>
                <dd>{report.totals.shiftsCompleted}</dd>
              </div>
              <div>
                <dt>Attendance rate</dt>
                <dd>{report.totals.attendanceRate}%</dd>
              </div>
            </dl>
          </div>

          <p className={styles.packetAside}>
            {t("{hours} h awaiting review", {
              hours: formatHours(report.totals.pendingMinutes),
            })}
            <span aria-hidden="true"> · </span>
            {report.totals.registrations} registrations in range
          </p>
        </section>
      ),
    },
    {
      key: "programs",
      node: (
        <section className={styles.packetSection} data-packet-section="programs">
          <div className={styles.packetSectionHead}>
            <h3 className={styles.packetSectionTitle}>Hours by program</h3>
            <p className={styles.packetSectionNote}>{selectedProgramTitle || "All programs"}</p>
          </div>
          {report.programs.length === 0 ? (
            <p className={styles.packetEmpty}>No program has hours in this range yet.</p>
          ) : (
            <table
              className={`${styles.packetTable} ${styles.packetProgramTable}`}
              data-testid="packet-programs"
            >
              <thead>
                <tr>
                  <th scope="col">Program</th>
                  <th scope="col" className={styles.packetLeft}>
                    Cause
                  </th>
                  <th scope="col">Verified hours</th>
                  <th scope="col">Hours awaiting review</th>
                  <th scope="col">Volunteers</th>
                  <th scope="col">Shifts</th>
                </tr>
              </thead>
              <tbody>
                {report.programs.map((program) => (
                  <tr key={program.id || "unassigned"}>
                    <th scope="row">{program.title}</th>
                    <td className={styles.packetLeft}>{program.cause || "—"}</td>
                    <td>{formatHours(program.verifiedMinutes)}</td>
                    <td>{formatHours(program.pendingMinutes)}</td>
                    <td>{program.volunteers}</td>
                    <td>{program.shiftsCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={styles.packetTableNote}>
            Verified service only; pending hours are named on each row.
          </p>
        </section>
      ),
    },
    {
      key: "months",
      node: (
        <section className={styles.packetSection} data-packet-section="months">
          <div className={styles.packetSectionHead}>
            <h3 className={styles.packetSectionTitle}>Monthly rhythm</h3>
            <p className={styles.packetSectionNote}>Verified hours by month</p>
          </div>
          {packetMonths.length === 0 ? (
            <p className={styles.packetEmpty}>No verified hours in this range yet.</p>
          ) : (
            <table
              className={`${styles.packetTable} ${styles.packetMonthTable}`}
              data-testid="packet-months"
            >
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Verified hours</th>
                  <th scope="col">Hours awaiting review</th>
                </tr>
              </thead>
              <tbody>
                {packetMonths.map((month) => (
                  <tr key={month.key}>
                    <th scope="row">{formatPacketMonth(month.key)}</th>
                    <td>{formatHours(month.verifiedMinutes)}</td>
                    <td>{formatHours(month.pendingMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ),
    },
    {
      key: "participation",
      node: (
        <section
          className={`${styles.packetSection} ${styles.packetTwoUp}`}
          data-packet-section="participation"
        >
          <div>
            <h3 className={styles.packetSectionTitle}>Participation</h3>
            <dl className={styles.packetStats}>
              <div>
                <dt>Volunteers</dt>
                <dd>{report.totals.volunteers}</dd>
              </div>
              <div>
                <dt>New volunteers</dt>
                <dd>{report.totals.newVolunteers}</dd>
              </div>
              <div>
                <dt>Avg. approved session</dt>
                <dd>{formatHours(averageSessionMinutes)} h</dd>
              </div>
              <div>
                <dt>Attendance rate</dt>
                <dd>{report.totals.attendanceRate}%</dd>
              </div>
            </dl>
            <p className={styles.packetSmallNote}>
              {report.totals.attended} attended · {noShowLabel}
            </p>
          </div>

          <div>
            <h3 className={styles.packetSectionTitle}>Credential readiness</h3>
            <dl className={styles.packetCounts}>
              <div>
                <dt>valid</dt>
                <dd>{report.credentials.valid}</dd>
              </div>
              <div>
                <dt>expiring</dt>
                <dd>{report.credentials.expiring}</dd>
              </div>
              <div>
                <dt>expired</dt>
                <dd>{report.credentials.expired}</dd>
              </div>
              <div>
                <dt>unverified</dt>
                <dd>{report.credentials.unverified}</dd>
              </div>
            </dl>
          </div>
        </section>
      ),
    },
    {
      key: "method",
      node: (
        <section
          className={`${styles.packetSection} ${styles.packetSectionLast}`}
          data-packet-section="method"
          data-testid="packet-method"
        >
          <h3 className={styles.packetSectionTitle}>How this was measured</h3>
          <p className={styles.packetMethodCopy}>
            Only approved service is issued. Pending and rejected hours are excluded.
          </p>
          <p className={styles.packetMethodCopy}>
            {t("Built from the synced copy at revision {revision}.", { revision })}{" "}
            {t("Waiting to upload: {pending}.", { pending: pendingLabel })}
          </p>
          <p className={styles.packetPrivacy}>
            This packet leaves out volunteer names and individual credentials.
          </p>
        </section>
      ),
    },
    {
      key: "footer",
      node: (
        <footer className={styles.packetFooter} data-packet-section="footer">
          <span>CivicFlow</span>
          <span>
            {organizationName}
            <span aria-hidden="true"> · </span>
            {rangeLabel}
          </span>
        </footer>
      ),
    },
  ];
}

export function FunderPacket({
  sections,
  className,
  testId,
  label = t("Funder packet"),
}: {
  sections: PacketSection[];
  className?: string;
  testId?: string;
  label?: string;
}) {
  return (
    <article
      className={`${styles.packet}${className ? ` ${className}` : ""}`}
      aria-label={label}
      data-testid={testId}
    >
      {sections.map((section) => (
        <Fragment key={section.key}>{section.node}</Fragment>
      ))}
    </article>
  );
}
