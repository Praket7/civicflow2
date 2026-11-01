import { useMemo, useState } from "react";
import { BarChart3, Download, Eye, Printer, RefreshCw } from "lucide-react";
import {
  Button,
  ButtonLink,
  EmptyState,
  Page,
  PageHeader,
  ProgressBar,
  SelectField,
  TextField,
} from "../../components/ui";
import { t } from "../../lib/i18n";
import { isTauri } from "../../lib/platform";
import { useSharedReportData } from "../../lib/sync/sharedReportSource";
import {
  buildSharedReport,
  presetRange,
  reportToCsv,
  type ReportPreset,
  type ReportRange,
} from "../../lib/sync/sharedReports";
import { FunderPacket, funderPacketSections } from "./FunderPacket";
import { FunderPacketPreview } from "./FunderPacketPreview";
import {
  formatHours as hours,
  formatReportDate as prettyDate,
  formatReportMonth as prettyMonth,
} from "./reportFormat";
import { SharedNav } from "./SharedNav";
import styles from "./shared.module.css";

const PRESETS: { value: ReportPreset; label: string }[] = [
  { value: "ytd", label: "Year to date" },
  { value: "90d", label: "Last 90 days" },
  { value: "quarter", label: "This quarter" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function SharedReportsPage() {
  const { sync, data, loading, error, reload } = useSharedReportData();
  const [preset, setPreset] = useState<ReportPreset>("ytd");
  const [range, setRange] = useState<ReportRange>(() => presetRange("ytd"));
  const [opportunityId, setOpportunityId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const opportunities = useMemo(
    () =>
      [...data.opportunities].sort((a, b) =>
        String(a.title ?? "").localeCompare(String(b.title ?? "")),
      ),
    [data.opportunities],
  );
  const report = useMemo(
    () => buildSharedReport(data, range, { opportunityId }),
    [data, range, opportunityId],
  );
  const pendingLabel = `${sync.pending} command${sync.pending === 1 ? "" : "s"}`;
  const noShowLabel = `${report.totals.noShows} no-show${report.totals.noShows === 1 ? "" : "s"}`;
  const organizationName = sync.organizationName || t("Shared workspace");
  const rangeLabel = `${prettyDate(report.from)} – ${prettyDate(report.to)}`;
  const selectedProgramTitle = opportunityId
    ? String(opportunities.find((row) => row.id === opportunityId)?.title ?? "")
    : "";
  const packetSections = useMemo(
    () =>
      funderPacketSections({
        report,
        organizationName,
        rangeLabel,
        selectedProgramTitle,
        revision: sync.revision,
        pendingLabel,
      }),
    [report, organizationName, rangeLabel, selectedProgramTitle, sync.revision, pendingLabel],
  );

  const programTotal = Math.max(1, ...report.programs.map((program) => program.verifiedMinutes));
  const monthTotal = Math.max(1, ...report.months.map((month) => month.verifiedMinutes));
  const busiestMonth = [...report.months].sort((a, b) => b.verifiedMinutes - a.verifiedMinutes)[0];

  function choosePreset(value: ReportPreset) {
    setPreset(value);
    if (value !== "custom") setRange(presetRange(value, new Date(), data));
  }

  function exportCsv() {
    const csv = reportToCsv(report);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `civicflow-impact-${report.from}-to-${report.to}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * The preview owns the print path: its measured sheets are the paper copy,
   * so the PDF cannot paginate differently from the pages the coordinator just
   * checked. The browser's print dialog is the PDF writer this app already
   * trusts. The document title becomes the default file name, so a saved packet
   * arrives as "Rivergate Kitchen impact report 2026-01-01 to 2026-10-31"
   * instead of the app's window title. The title is only borrowed until the
   * dialog closes.
   */
  function printPacket() {
    if (!report.hasData) return;
    const previous = document.title;
    document.title = `${organizationName} impact report ${report.from} to ${report.to}`;
    const restore = () => {
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  return (
    <Page width="wide">
      <div className={styles.shell}>
        <PageHeader
          eyebrow="Shared coordinator"
          title="Impact report"
          description="Verified service over the hosted organization, computed from the synced copy. The report works with the network down and never edits a row."
          backTo="/shared"
          backLabel="Hosted workspace"
          actions={
            <div className={styles.actions}>
              <Button
                variant="secondary"
                icon={<RefreshCw aria-hidden size={14} />}
                disabled={loading || !isTauri()}
                onClick={() => void reload()}
              >
                {loading ? "Reading…" : "Sync now"}
              </Button>
              <Button
                variant="secondary"
                icon={<Download aria-hidden size={14} />}
                disabled={!report.hasData || !isTauri()}
                onClick={exportCsv}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                icon={<Eye aria-hidden size={14} />}
                disabled={!report.hasData || !isTauri()}
                onClick={() => setPreviewOpen(true)}
              >
                Preview
              </Button>
              <Button
                variant="primary"
                icon={<Printer aria-hidden size={14} />}
                disabled={!report.hasData || !isTauri()}
                onClick={() => setPreviewOpen(true)}
              >
                Print / save PDF
              </Button>
            </div>
          }
        />

        <SharedNav conflicts={sync.conflicts} />

        {!isTauri() ? (
          <section className={styles.panel}>
            <div className={styles.panelBody}>
              <h2 className={styles.panelTitle}>This screen lives in the desktop app</h2>
              <p className={styles.panelCopy}>
                The browser build uses the hosted workspace. Open CivicFlow on this computer to read
                the report from the encrypted replica.
              </p>
              <div style={{ marginTop: 12 }}>
                <ButtonLink to="/shared" variant="secondary">
                  Open hosted workspace
                </ButtonLink>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className={styles.panel} aria-labelledby="report-range">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="report-range" className={styles.panelTitle}>
                    Reporting period
                  </h2>
                  <p className={styles.panelCopy}>
                    A shift counts on the day it starts. Hours count on the day they were served,
                    not the day a coordinator approved them.
                  </p>
                </div>
              </div>
              <div className={styles.reportRange}>
                <SelectField
                  label="Range"
                  value={preset}
                  onChange={(event) => choosePreset(event.target.value as ReportPreset)}
                >
                  {PRESETS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="From"
                  type="date"
                  value={range.from}
                  onChange={(event) => {
                    setPreset("custom");
                    setRange((current) => ({ ...current, from: event.target.value }));
                  }}
                />
                <TextField
                  label="To"
                  type="date"
                  value={range.to}
                  onChange={(event) => {
                    setPreset("custom");
                    setRange((current) => ({ ...current, to: event.target.value }));
                  }}
                />
                <SelectField
                  label="Program"
                  value={opportunityId}
                  onChange={(event) => setOpportunityId(event.target.value)}
                >
                  <option value="">All programs</option>
                  {opportunities.map((opportunity) => (
                    <option key={opportunity.id} value={opportunity.id}>
                      {String(opportunity.title ?? "Untitled program")}
                    </option>
                  ))}
                </SelectField>
              </div>
              <p className={styles.reportNote}>
                {prettyDate(report.from)} to {prettyDate(report.to)} · generated{" "}
                {prettyDate(report.generatedAt)}
              </p>
              <p className={styles.reportNote}>
                This packet leaves out volunteer names and individual credentials.
              </p>
            </section>

            {error ? (
              <p role="alert" className={`${styles.notice} ${styles.noticeError}`}>
                {error}
              </p>
            ) : null}

            {loading ? (
              <p className={styles.notice}>Reading every report row from this computer…</p>
            ) : null}

            <section className={styles.stats} aria-label="Report summary">
              <div className={styles.stat}>
                <p className={styles.statLabel}>Verified hours</p>
                <p className={styles.statValue}>{hours(report.totals.verifiedMinutes)} h</p>
                <p className={styles.statHint}>
                  {hours(report.totals.pendingMinutes)} h waiting for review
                </p>
              </div>
              <div className={styles.stat}>
                <p className={styles.statLabel}>Volunteers</p>
                <p className={styles.statValue}>{report.totals.volunteers}</p>
                <p className={styles.statHint}>
                  {report.totals.newVolunteers} serving for the first time
                </p>
              </div>
              <div className={styles.stat}>
                <p className={styles.statLabel}>Shifts completed</p>
                <p className={styles.statValue}>{report.totals.shiftsCompleted}</p>
                <p className={styles.statHint}>
                  {report.totals.registrations} registrations in range
                </p>
              </div>
              <div className={styles.stat}>
                <p className={styles.statLabel}>Attendance</p>
                <p className={styles.statValue}>{report.totals.attendanceRate}%</p>
                <p className={styles.statHint}>
                  {report.totals.attended} attended · {noShowLabel}
                </p>
              </div>
            </section>

            {!report.hasData ? (
              <EmptyState
                title="Nothing to report in this range"
                copy="No verified hours, attendance, or completed shifts fall between these dates. Widen the range or choose another program."
              />
            ) : (
              <>
                <div className={styles.reportGrid}>
                  <section className={styles.panel} aria-labelledby="report-programs">
                    <div className={styles.panelHead}>
                      <div>
                        <h2 id="report-programs" className={styles.panelTitle}>
                          Hours by program
                        </h2>
                        <p className={styles.panelCopy}>
                          Verified service only; pending hours are named on each row.
                        </p>
                      </div>
                    </div>
                    <div className={styles.panelBody}>
                      {report.programs.length === 0 ? (
                        <p className={styles.muted}>No program has hours in this range yet.</p>
                      ) : (
                        <div className={styles.reportBarList}>
                          {report.programs.map((program) => (
                            <div key={program.id || "unassigned"}>
                              <div className={styles.reportBarLabel}>
                                <span className={styles.strong}>{program.title}</span>
                                <span>
                                  {hours(program.verifiedMinutes)} h · {program.volunteers}{" "}
                                  volunteers
                                </span>
                              </div>
                              <ProgressBar
                                value={share(program.verifiedMinutes, programTotal)}
                                label={`${program.title} verified hours`}
                              />
                              {program.pendingMinutes > 0 ? (
                                <p className={styles.reportNote}>
                                  {hours(program.pendingMinutes)} h pending review
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className={styles.panel} aria-labelledby="report-months">
                    <div className={styles.panelHead}>
                      <div>
                        <h2 id="report-months" className={styles.panelTitle}>
                          Monthly rhythm
                        </h2>
                        <p className={styles.panelCopy}>
                          {busiestMonth && busiestMonth.verifiedMinutes > 0
                            ? `${prettyMonth(busiestMonth.key)} was the busiest month in this range.`
                            : "No verified hours in this range yet."}
                        </p>
                      </div>
                    </div>
                    <div className={styles.panelBody}>
                      <div className={styles.reportBarList}>
                        {report.months.map((month) => (
                          <div key={month.key}>
                            <div className={styles.reportBarLabel}>
                              <span>{prettyMonth(month.key)}</span>
                              <span>{hours(month.verifiedMinutes)} h</span>
                            </div>
                            <ProgressBar
                              value={share(month.verifiedMinutes, monthTotal)}
                              label={`${prettyMonth(month.key)} verified hours`}
                              tone="var(--tone-green-ink)"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>

                <section className={styles.panel} aria-labelledby="report-volunteers">
                  <div className={styles.panelHead}>
                    <div>
                      <h2 id="report-volunteers" className={styles.panelTitle}>
                        Volunteer participation
                      </h2>
                      <p className={styles.panelCopy}>
                        Ranked by verified hours. Every volunteer is included in the CSV export.
                      </p>
                    </div>
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">Volunteer</th>
                          <th scope="col">Verified</th>
                          <th scope="col">Pending</th>
                          <th scope="col">Shifts</th>
                          <th scope="col">Last served</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.volunteers.slice(0, 10).map((volunteer) => (
                          <tr key={volunteer.id}>
                            <th scope="row" className={styles.strong}>
                              {volunteer.name}
                            </th>
                            <td>{hours(volunteer.verifiedMinutes)} h</td>
                            <td>{hours(volunteer.pendingMinutes)} h</td>
                            <td>{volunteer.shifts}</td>
                            <td>{prettyDate(volunteer.lastServed)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.volunteers.length > 10 ? (
                    <p className={styles.reportNote}>
                      Showing 10 of {report.volunteers.length} volunteers.
                    </p>
                  ) : null}
                </section>

                <section className={styles.panel} aria-labelledby="report-credentials">
                  <div className={styles.panelHead}>
                    <div>
                      <h2 id="report-credentials" className={styles.panelTitle}>
                        Credential readiness
                      </h2>
                      <p className={styles.panelCopy}>
                        Expiring means sixty days or less; an expired credential blocks new
                        assignments in AutoRoster.
                      </p>
                    </div>
                    <div className={styles.actions}>
                      <span className={`${styles.pill} ${styles.pillGood}`}>
                        {report.credentials.valid} valid
                      </span>
                      <span className={`${styles.pill} ${styles.pillOpen}`}>
                        {report.credentials.expiring} expiring
                      </span>
                      <span className={`${styles.pill} ${styles.pillBad}`}>
                        {report.credentials.expired} expired
                      </span>
                      <span className={styles.pill}>
                        {report.credentials.unverified} unverified
                      </span>
                    </div>
                  </div>
                  <div className={styles.panelBody}>
                    {report.credentials.expiringSoon.length === 0 ? (
                      <p className={styles.muted}>No credential expires in the next sixty days.</p>
                    ) : (
                      <ul className={styles.credentialList}>
                        {report.credentials.expiringSoon.slice(0, 6).map((credential) => (
                          <li key={credential.id} className={styles.credentialRow}>
                            <span className={styles.credentialIcon}>
                              <BarChart3 aria-hidden size={14} />
                            </span>
                            <div className={styles.credentialCopy}>
                              <p className={styles.credentialName}>{credential.typeName}</p>
                              <p className={styles.credentialMeta}>
                                {credential.volunteerName} · valid through{" "}
                                {prettyDate(credential.validThrough)}
                              </p>
                            </div>
                            <span
                              className={`${styles.pill} ${
                                credential.state === "expired" ? styles.pillBad : styles.pillOpen
                              }`}
                            >
                              {credential.state === "expired" ? "Expired" : "Expiring"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </>
            )}

            <p className={styles.reportNote} data-testid="report-footnote">
              {t("Built from the synced copy at revision {revision}.", {
                revision: sync.revision,
              })}{" "}
              {t("Waiting to upload: {pending}.", { pending: pendingLabel })}
            </p>
          </>
        )}

        {isTauri() && report.hasData ? (
          <FunderPacket sections={packetSections} testId="funder-packet" />
        ) : null}

        {isTauri() && report.hasData && previewOpen ? (
          <FunderPacketPreview
            sections={packetSections}
            organizationName={organizationName}
            rangeLabel={rangeLabel}
            onClose={() => setPreviewOpen(false)}
            onPrint={printPacket}
          />
        ) : null}
      </div>
    </Page>
  );
}
