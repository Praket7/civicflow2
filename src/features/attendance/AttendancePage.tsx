import { useState } from "react";
import type { CSSProperties } from "react";
import { CalendarDays, Clock3, MapPin, MonitorUp, UserCheck, UserX, Users } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  Page,
  PageHeader,
  StatCard,
  statusLabel,
  statusTone,
} from "../../components/ui";
import type { Column } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useCheckinWindow } from "../../lib/workspace/queries";
import { useWorkspace } from "../../lib/workspace/session";
import {
  formatDate,
  formatTime,
  getAttendanceRoster,
  getLiveEvent,
  rosterCounts,
  timeRange,
} from "../../lib/workspace/selectors";
import type { RosterRow } from "../../lib/workspace/selectors";
import { WorkAreaTabs } from "../../components/navigation/WorkAreaTabs";
import { scheduleTabs } from "../../app/workAreas";
import styles from "./Attendance.module.css";

export function AttendancePage() {
  const { workspace, session, actions } = useWorkspace();
  const event = getLiveEvent(session, workspace);
  const { data: checkinWindow } = useCheckinWindow(event?.shift.id ?? "");
  const [message, setMessage] = useState("");
  if (!event) {
    return (
      <Page>
        <WorkAreaTabs label="Schedule" items={scheduleTabs} />
        <PageHeader
          title={t("Attendance")}
          description={t("Check-in evidence, late arrivals, and no-show follow-up list.")}
        />
        <Card>
          <p>{t("Nothing is scheduled yet.")}</p>
          <p>{t("Publish a shift to start filling roles.")}</p>
        </Card>
      </Page>
    );
  }
  // Also keeps no-shows, so the absence and the open seat read together.
  const roster = getAttendanceRoster(event.shift.id, session, workspace);
  const counts = rosterCounts(roster);
  const capacity = event.shift.capacity;
  const attendancePercent = capacity === 0 ? 0 : Math.round((counts.checkedIn / capacity) * 100);

  const checkedRows = roster
    .filter((row) => row.status === "checked_in" || row.status === "completed")
    .sort((a, b) => (b.checkedInAt ?? "").localeCompare(a.checkedInAt ?? ""));
  const attentionRows = roster.filter(
    (row) => row.status === "expected" || row.status === "no_show",
  );

  function announce(text: string) {
    setMessage(text);
  }

  const columns: Column<RosterRow & { id: string }>[] = [
    {
      key: "volunteer",
      header: "Volunteer",
      render: (row) => (
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Avatar initials={row.volunteer.initials} tone={row.volunteer.tone} size={28} />
          <div>
            <div style={{ fontWeight: 570 }}>{row.volunteer.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{row.volunteer.email}</div>
          </div>
        </div>
      ),
    },
    { key: "role", header: "Role", render: (row) => row.role },
    {
      key: "scheduled",
      header: "Scheduled",
      render: () => timeRange(event.shift.startsAt, event.shift.endsAt),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={statusTone(row.status)} dot>
          {statusLabel(row.status)}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (row) => (
        <div className={styles.rowActions}>
          {row.status === "checked_in" ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => {
                actions.checkOut(event.shift.id, row.volunteer.id);
                announce(t("{name} checked out.", { name: row.volunteer.name }));
              }}
            >
              Check out
            </button>
          ) : (
            <button
              type="button"
              className={styles.actionButton}
              disabled={row.status === "completed" || row.status === "no_show"}
              onClick={() => {
                actions.manualCheckIn(
                  event.shift.id,
                  row.volunteer.id,
                  "Recorded by a coordinator at the attendance board",
                );
                announce(t("{name} checked in.", { name: row.volunteer.name }));
              }}
            >
              Check in
            </button>
          )}
          {row.status === "expected" || row.status === "confirmed" ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => {
                actions.markNoShow(event.shift.id, row.volunteer.id);
                announce(t("{name} marked as no-show.", { name: row.volunteer.name }));
              }}
            >
              No-show
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  const rows = roster.map((row) => ({ ...row, id: row.volunteer.id }));

  return (
    <Page>
      <WorkAreaTabs label="Schedule" items={scheduleTabs} />
      <PageHeader
        eyebrow="Live event"
        title="Attendance"
        description="Check volunteers in, track arrivals, and close the loop on no-shows. Every action is written to the event audit trail."
        actions={
          <>
            <ButtonLink
              to="/coordinator/schedule"
              variant="secondary"
              icon={<CalendarDays size={14} />}
            >
              Full schedule
            </ButtonLink>
            <ButtonLink to="/coordinator/kiosk" variant="primary" icon={<MonitorUp size={14} />}>
              Open kiosk
            </ButtonLink>
          </>
        }
      />

      <section className={styles.eventBanner} aria-label="Today's event">
        <img
          className={styles.eventImage}
          src={event.opportunity?.image ?? "/media/opp-pantry.jpg"}
          alt=""
          aria-hidden="true"
        />
        <span className={styles.eventOverlay} aria-hidden="true" />
        <div className={styles.eventCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" />
            {checkinWindow
              ? checkinWindow.canSelfCheckIn
                ? t("Check-in is open")
                : t("Check-in closed")
              : null}
          </p>
          <h2 className={styles.eventTitle}>{event.opportunity?.title ?? "Pantry Setup"}</h2>
          <div className={styles.eventMeta}>
            <span>
              <CalendarDays size={12} aria-hidden="true" /> {formatDate(event.shift.startsAt)}
            </span>
            <span>
              <Clock3 size={12} aria-hidden="true" />{" "}
              {timeRange(event.shift.startsAt, event.shift.endsAt)}
            </span>
            <span>
              <MapPin size={12} aria-hidden="true" />{" "}
              {event.opportunity?.address ?? "214 Rivergate Avenue, Buffalo"}
            </span>
          </div>
          <div className={styles.eventActions}>
            <ButtonLink to={`/coordinator/shifts/${event.shift.id}`} variant="lime" size="small">
              Live roster
            </ButtonLink>
            <ButtonLink to="/volunteer/check-in" variant="secondary" size="small">
              Volunteer check-in view
            </ButtonLink>
          </div>
        </div>
        <div
          className={styles.eventRing}
          style={{ "--ring-fill": `${attendancePercent}%` } as CSSProperties}
          role="img"
          aria-label={t("{percent} percent attendance", { percent: attendancePercent })}
        >
          <div>
            <div className={styles.ringValue}>{attendancePercent}%</div>
            <div className={styles.ringLabel}>attendance</div>
          </div>
        </div>
      </section>

      <div className={styles.statGrid}>
        <StatCard
          icon={UserCheck}
          value={counts.checkedIn}
          label="Checked in"
          meta={t("of {count} seats", { count: capacity })}
          tone="green"
        />
        <StatCard
          icon={Users}
          value={counts.expected}
          label="Expected"
          meta="not yet arrived"
          tone="cobalt"
        />
        <StatCard
          icon={UserX}
          value={counts.noShow}
          label="No-shows"
          meta="follow-up needed"
          tone="coral"
        />
        <StatCard
          icon={Clock3}
          value={event.waitlist.filter((row) => row.status === "waiting").length}
          label="On waitlist"
          meta="ready to promote"
          tone="violet"
        />
      </div>

      <p className={styles.liveRegion} role="status" aria-live="polite">
        {message}
      </p>

      <div className={styles.bodyGrid}>
        <Card padding="compact">
          <div className={styles.railTitle}>
            <span>Event roster</span>
            <Badge tone="neutral">
              {roster.length} / {capacity} confirmed
            </Badge>
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            caption={t("Roster for {program}", {
              program: event.opportunity?.title ?? t("today's shift"),
            })}
            empty="No volunteers are confirmed yet. Promote someone from the waitlist or open AutoRoster."
          />
        </Card>

        <aside className={styles.rail} aria-label="Attendance support">
          <Card className={styles.railCard} padding="compact">
            <div className={styles.railTitle}>
              <span>Needs attention</span>
              <Badge tone={attentionRows.length > 0 ? "amber" : "green"}>
                {t("{count} open", { count: attentionRows.length })}
              </Badge>
            </div>
            {attentionRows.length === 0 ? (
              <p className={styles.muted}>Everyone expected is checked in. Nothing to chase.</p>
            ) : (
              <div className={styles.railList}>
                {attentionRows.map((row) => (
                  <div className={styles.railRow} key={row.volunteer.id}>
                    <Avatar initials={row.volunteer.initials} tone={row.volunteer.tone} size={28} />
                    <div className={styles.railCopy}>
                      <div className={styles.railName}>{row.volunteer.name}</div>
                      <div className={styles.railMeta}>
                        {row.status === "no_show"
                          ? t("Marked no-show")
                          : t("Expected · {role}", { role: row.role })}
                      </div>
                    </div>
                    {row.status === "expected" ? (
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => {
                          actions.manualCheckIn(
                            event.shift.id,
                            row.volunteer.id,
                            "Recorded by a coordinator at the attendance board",
                          );
                          announce(t("{name} checked in.", { name: row.volunteer.name }));
                        }}
                      >
                        Check in
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className={styles.railCard} padding="compact">
            <div className={styles.railTitle}>
              <span>Recent check-ins</span>
              <Badge tone="green" dot>
                live
              </Badge>
            </div>
            {checkedRows.length === 0 ? (
              <p className={styles.muted}>
                No arrivals yet. The kiosk count updates here immediately.
              </p>
            ) : (
              <div className={styles.railList}>
                {checkedRows.map((row) => (
                  <div className={styles.railRow} key={row.volunteer.id}>
                    <Avatar initials={row.volunteer.initials} tone={row.volunteer.tone} size={26} />
                    <div className={styles.railCopy}>
                      <div className={styles.railName}>{row.volunteer.name}</div>
                      <div className={styles.railMeta}>{row.role}</div>
                    </div>
                    <span className={styles.clock}>
                      {row.checkedInAt ? formatTime(row.checkedInAt) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card padding="compact" surface="dark">
            <div className={styles.railTitle}>
              <span>Coverage check</span>
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "rgba(255,255,255,0.7)" }}>
              {t(
                "{checked} of {total} confirmed volunteers are on site. If a role is still uncovered, promote from the waitlist before the event ends.",
                { checked: counts.checkedIn, total: roster.length },
              )}
            </p>
            <ButtonLink
              to={`/coordinator/shifts/${event.shift.id}`}
              variant="lime"
              size="small"
              className="mt"
            >
              Review roles
            </ButtonLink>
          </Card>
        </aside>
      </div>
    </Page>
  );
}
