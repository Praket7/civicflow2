import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Award,
  BadgeCheck,
  CalendarCheck2,
  Clock3,
  Download,
  FileCheck2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  AreaChart,
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  Page,
  PageHeader,
  ProgressBar,
  SectionHeader,
  StatCard,
  Tabs,
  statusLabel,
  statusTone,
} from "../../components/ui";
import type { Column, TabItem } from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import type { HourRow } from "../../lib/workspace/selectors";
import {
  currentVolunteer,
  formatHours,
  formatMinutes,
  getHoursSummary,
  getRoster,
  getHourRows,
} from "../../lib/workspace/selectors";
import { t } from "../../lib/i18n";
import { useWorkspace } from "../../lib/workspace/session";
import { WorkAreaTabs } from "../../components/navigation/WorkAreaTabs";
import { hoursTabs } from "../../app/workAreas";
import styles from "./MyHoursPage.module.css";

type TabKey = "history" | "pending" | "certificates";

function statusBadge(status: HourRow["status"]) {
  return (
    <Badge tone={statusTone(status)} dot>
      {statusLabel(status)}
    </Badge>
  );
}

export function MyHoursPage() {
  const { workspace, session } = useWorkspace();
  const volunteer = currentVolunteer(workspace);
  const [tab, setTab] = useState<TabKey>("history");
  const [exportMessage, setExportMessage] = useState("");

  const summary = getHoursSummary(volunteer.id, session, workspace);
  const rows = getHourRows(session, workspace)
    .filter((row) => row.volunteer.id === volunteer.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const pendingRows = rows.filter((row) => row.status === "pending");
  const verifiedRows = rows.filter((row) => row.status === "verified");
  const certificates = useMemo(() => {
    const map = new Map<
      string,
      { code: string; rows: HourRow[]; minutes: number; latest: string }
    >();
    for (const row of verifiedRows) {
      if (!row.verificationId) continue;
      const current = map.get(row.verificationId) ?? {
        code: row.verificationId,
        rows: [],
        minutes: 0,
        latest: row.date,
      };
      current.rows.push(row);
      current.minutes += row.approvedMinutes ?? row.requestedMinutes;
      if (row.date > current.latest) current.latest = row.date;
      map.set(row.verificationId, current);
    }
    return [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest));
  }, [verifiedRows]);

  const totalHours = Math.round((summary.totalMinutes / 60) * 10) / 10;
  const verifiedHours = Math.round((summary.verifiedMinutes / 60) * 10) / 10;
  const pendingHours = Math.round((summary.pendingMinutes / 60) * 10) / 10;
  const milestoneMinutes = 25 * 60;
  const milestoneProgress = Math.min(
    100,
    Math.round((summary.totalMinutes / milestoneMinutes) * 100),
  );
  const milestoneRemaining = Math.max(0, milestoneMinutes - summary.totalMinutes);

  const chartData = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const row of rows) {
      byDate.set(
        row.date,
        (byDate.get(row.date) ?? 0) + (row.approvedMinutes ?? row.requestedMinutes),
      );
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, minutes]) => ({
        label: format(parseISO(date), "MMM d"),
        value: Math.round((minutes / 60) * 10) / 10,
      }));
  }, [rows]);

  const tabs: TabItem[] = [
    { id: "history", label: "History", count: rows.length },
    { id: "pending", label: "Pending", count: pendingRows.length },
    { id: "certificates", label: "Certificates", count: certificates.length },
  ];

  function roleFor(row: HourRow): string {
    if (row.shiftId) {
      const rosterRow = getRoster(row.shiftId, session, workspace).find(
        (entry) => entry.volunteer.id === volunteer.id,
      );
      if (rosterRow) return rosterRow.role;
    }
    return row.opportunity.requirements[0] ?? "Volunteer support";
  }

  const columns: Column<HourRow>[] = [
    {
      key: "date",
      header: "Date",
      width: "118px",
      render: (row) => (
        <div>
          <div className={styles.dateMain}>{format(parseISO(row.date), "MMM d")}</div>
          <div className={styles.dateSub}>{format(parseISO(row.date), "yyyy")}</div>
        </div>
      ),
    },
    {
      key: "opportunity",
      header: "Opportunity",
      render: (row) => (
        <div className={styles.opportunityCell}>
          <img className={styles.thumb} src={row.opportunity.image} alt="" loading="lazy" />
          <div className={styles.opportunityCopy}>
            <span className={styles.opportunityTitle}>{row.opportunity.title}</span>
            <span className={styles.opportunityMeta}>{roleFor(row)}</span>
          </div>
        </div>
      ),
    },
    {
      key: "hours",
      header: "Hours",
      align: "right",
      width: "112px",
      render: (row) => {
        const approved = row.approvedMinutes !== null ? formatMinutes(row.approvedMinutes) : "—";
        const adjusted =
          row.approvedMinutes !== null && row.approvedMinutes !== row.requestedMinutes;
        return (
          <div className={styles.hoursCell}>
            <span className={styles.hoursValue}>
              {adjusted
                ? `${approved} / ${formatMinutes(row.requestedMinutes)}`
                : formatMinutes(row.requestedMinutes)}
            </span>
            <span className={styles.hoursSub}>
              {t(
                adjusted
                  ? "approved / requested"
                  : row.status === "pending"
                    ? "requested"
                    : "recorded",
              )}
            </span>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "104px",
      render: (row) => statusBadge(row.status),
    },
    {
      key: "verification",
      header: "Verification",
      width: "132px",
      render: (row) =>
        row.verificationId ? (
          <span className={styles.code}>{row.verificationId}</span>
        ) : (
          <span className={styles.muted}>{t("Awaiting review")}</span>
        ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      width: "96px",
      render: (row) => (
        <Link className={styles.rowAction} to="/volunteer/verification">
          Open
          <span className="visually-hidden"> record for {row.opportunity.title}</span>
        </Link>
      ),
    },
  ];

  function exportCsv() {
    const exportRows =
      tab === "pending" ? pendingRows : tab === "certificates" ? verifiedRows : rows;
    const lines = [
      [
        "Date",
        "Opportunity",
        "Role",
        "Requested minutes",
        "Approved minutes",
        "Status",
        "Verification ID",
      ],
      ...exportRows.map((row) => [
        row.date,
        row.opportunity.title,
        roleFor(row),
        row.requestedMinutes,
        row.approvedMinutes ?? "",
        row.status,
        row.verificationId ?? "",
      ]),
    ];
    downloadCsv(`civicflow-hours-${volunteer.firstName.toLowerCase()}-${tab}.csv`, lines);
    setExportMessage(
      `CSV exported with ${exportRows.length} ${exportRows.length === 1 ? "record" : "records"}.`,
    );
  }

  const correctionMailto = `mailto:${workspace.organization.email}?subject=${encodeURIComponent(
    `Hours correction request — ${volunteer.name}`,
  )}&body=${encodeURIComponent(
    `Hi ${workspace.coordinator.firstName},\n\nI would like to request a correction to one of my service records.\n\nDate:\nOpportunity:\nWhat needs correcting:\n\nThank you,\n${volunteer.name}`,
  )}`;

  return (
    <Page>
      <WorkAreaTabs label="Hours and impact" items={hoursTabs} />
      <PageHeader
        eyebrow="Service record"
        title="My hours"
        description="Your recorded service, approved hours, and official records, all from the same ledger."
        actions={
          <>
            <Button
              variant="secondary"
              size="small"
              icon={<Mail size={13} aria-hidden="true" />}
              onClick={() => {
                window.location.href = correctionMailto;
              }}
            >
              Request correction
            </Button>
            <Button
              variant="primary"
              size="small"
              icon={<Download size={13} aria-hidden="true" />}
              onClick={exportCsv}
            >
              Export CSV
            </Button>
          </>
        }
      />

      <section className={styles.identityBand} aria-label="Your service record summary">
        <div className={styles.identityMain}>
          <Avatar
            initials={volunteer.initials}
            tone={volunteer.tone}
            size={54}
            label={volunteer.name}
          />
          <div className={styles.identityCopy}>
            <h2 className={styles.identityName}>{volunteer.name}</h2>
            <p className={styles.identityMeta}>
              Volunteer since {format(parseISO(volunteer.joinedAt), "MMM yyyy")} ·{" "}
              {volunteer.attendanceRate}% attendance · {summary.events} programs
            </p>
            <div className={styles.identityBadges}>
              <Badge tone="green" dot>
                Service record active
              </Badge>
              <Badge tone="neutral">Buffalo, NY</Badge>
            </div>
          </div>
        </div>

        <div className={styles.totalBlock}>
          <div className={styles.totalValueRow}>
            <span className={styles.totalValue}>{totalHours}</span>
            <span className={styles.totalUnit}>hours recorded</span>
          </div>
          <p className={styles.totalNote}>
            {t("{verified} verified · {pending} awaiting review", {
              verified: formatHours(verifiedHours),
              pending: formatHours(pendingHours),
            })}
          </p>
          <div className={styles.milestone}>
            <div className={styles.milestoneTop}>
              <span>Next milestone · {milestoneMinutes / 60} h</span>
              <span>{formatMinutes(milestoneRemaining)} to go</span>
            </div>
            <ProgressBar
              value={milestoneProgress}
              tone="var(--color-green)"
              label={`${milestoneProgress}% toward the ${milestoneMinutes / 60} hour milestone`}
            />
          </div>
          <Link className={styles.verificationLink} to="/volunteer/verification">
            <ShieldCheck size={13} aria-hidden="true" />
            View official service records
          </Link>
        </div>
      </section>

      <div className={styles.statsGrid}>
        <StatCard
          icon={BadgeCheck}
          tone="green"
          value={formatHours(verifiedHours)}
          label="Verified hours"
          meta="Approved by a coordinator"
        />
        <StatCard
          icon={Clock3}
          tone="amber"
          value={formatHours(pendingHours)}
          label="Awaiting review"
          meta={t(
            pendingRows.length === 1 ? "{count} entry in review" : "{count} entries in review",
            { count: pendingRows.length },
          )}
        />
        <StatCard
          icon={CalendarCheck2}
          tone="cobalt"
          value={summary.events}
          label="Programs served"
          meta="This year"
        />
        <StatCard
          icon={Award}
          tone="violet"
          value={certificates.length}
          label="Official records"
          meta="Verified and shareable"
        />
      </div>

      <Card className={styles.chartCard}>
        <SectionHeader
          title="Hours over time"
          subtitle={t("Recorded service for {month}, from approved and pending entries.", {
            month: format(parseISO(workspace.now), "MMMM yyyy"),
          })}
          action={<Badge tone="neutral">This month</Badge>}
        />
        {chartData.length > 0 ? (
          <AreaChart
            data={chartData}
            height={172}
            color="var(--color-cobalt)"
            label={`Hours recorded in ${format(parseISO(workspace.now), "MMMM yyyy")}`}
            formatValue={(value) => `${value} h`}
          />
        ) : (
          <EmptyState
            title="No hours recorded yet"
            copy="Once you complete a shift and submit your hours, your service trend will appear here."
            action={<ButtonLink to="/volunteer/discover">Find a shift</ButtonLink>}
          />
        )}
        <div className={styles.chartFooter}>
          <span className={styles.chartKey}>
            <span className={styles.chartDot} aria-hidden="true" />
            Recorded hours · {formatHours(totalHours)} this year
          </span>
          <span className={styles.chartHint}>
            Hours are reviewed before they appear on official records.
          </span>
        </div>
      </Card>

      <Card className={styles.recordsCard}>
        <div className={styles.recordsToolbar}>
          <Tabs
            items={tabs}
            value={tab}
            onChange={(value) => setTab(value as TabKey)}
            label="Hour records"
          />
          <span className={styles.toolbarHint}>
            {rows.length} records · {formatHours(verifiedHours)} verified
          </span>
        </div>

        <p className={styles.liveRegion} role="status" aria-live="polite">
          {exportMessage}
        </p>

        {tab === "history" ? (
          <DataTable
            columns={columns}
            rows={rows}
            caption="Your service hours"
            empty="No service hours yet. Complete a shift to start your record."
          />
        ) : null}

        {tab === "pending" ? (
          pendingRows.length > 0 ? (
            <>
              <div className={styles.pendingNotice}>
                <span className={styles.pendingIcon} aria-hidden="true">
                  <Clock3 size={15} />
                </span>
                <div>
                  <p className={styles.pendingTitle}>Waiting on a coordinator</p>
                  <p className={styles.pendingCopy}>
                    Pending entries are checked against check-in and check-out evidence. You will
                    get a notification when they are approved or adjusted.
                  </p>
                </div>
              </div>
              <DataTable
                columns={columns}
                rows={pendingRows}
                caption="Hours awaiting review"
                empty="Nothing is waiting for review."
              />
            </>
          ) : (
            <EmptyState
              title="You're all caught up"
              copy="Every submitted entry has been reviewed. New submissions appear here until a coordinator approves them."
              action={<ButtonLink to="/volunteer/schedule">View my schedule</ButtonLink>}
            />
          )
        ) : null}

        {tab === "certificates" ? (
          certificates.length > 0 ? (
            <div className={styles.certificateGrid}>
              {certificates.map((certificate) => (
                <Card key={certificate.code} surface="quiet" className={styles.certificate}>
                  <div className={styles.certificateTop}>
                    <span className={styles.certificateIcon} aria-hidden="true">
                      <FileCheck2 size={18} />
                    </span>
                    <Badge tone="green" dot>
                      Verified
                    </Badge>
                  </div>
                  <h3 className={styles.certificateTitle}>Volunteer service record</h3>
                  <p className={styles.certificateMeta}>
                    {workspace.organization.name} · Issued{" "}
                    {format(parseISO(certificate.latest), "MMMM d, yyyy")}
                  </p>
                  <div className={styles.certificateNumbers}>
                    <div>
                      <span className={styles.certificateValue}>
                        {formatMinutes(certificate.minutes)}
                      </span>
                      <span className={styles.certificateLabel}>Verified service</span>
                    </div>
                    <div>
                      <span className={styles.certificateValue}>{certificate.rows.length}</span>
                      <span className={styles.certificateLabel}>
                        {certificate.rows.length === 1 ? "Entry" : "Entries"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.certificateCode}>
                    <span className={styles.code}>{certificate.code}</span>
                  </div>
                  <div className={styles.certificateActions}>
                    <ButtonLink
                      to="/volunteer/verification"
                      variant="secondary"
                      size="small"
                      icon={<ShieldCheck size={13} aria-hidden="true" />}
                    >
                      Open record
                    </ButtonLink>
                    <Button
                      variant="ghost"
                      size="small"
                      icon={<Download size={13} aria-hidden="true" />}
                      onClick={exportCsv}
                    >
                      Export CSV
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No verified records yet"
              copy="Official service records are generated after approved hours. Pending entries will appear here once reviewed."
              action={<ButtonLink to="/volunteer/verification">View verification</ButtonLink>}
            />
          )
        ) : null}
      </Card>

      <p className={styles.footnote}>
        Hours are stored as whole minutes, then rounded for display. Approved records are the only
        source for official verification.
      </p>
    </Page>
  );
}
