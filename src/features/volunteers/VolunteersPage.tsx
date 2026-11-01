import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Mail,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  Page,
  PageHeader,
  SearchField,
  StatCard,
} from "../../components/ui";
import type { Column } from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { useWorkspace } from "../../lib/workspace/session";
import { WorkAreaTabs } from "../../components/navigation/WorkAreaTabs";
import { peopleTabs } from "../../app/workAreas";
import {
  CAUSE_LABELS,
  formatHours,
  getCredentials,
  getUpcomingForVolunteer,
  formatDate,
  timeRange,
} from "../../lib/workspace/selectors";
import type { Volunteer } from "../../types/domain";
import styles from "./VolunteersPage.module.css";

type SortKey = "name" | "hours" | "attendance" | "joined";

const PAGE_SIZE = 12;

function needsAttention(volunteer: Volunteer): boolean {
  return volunteer.attendanceRate < 85 || volunteer.eventsCompleted < 5;
}

export function VolunteersPage() {
  const { workspace, session } = useWorkspace();
  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState("all");
  const [cause, setCause] = useState("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const volunteers = workspace.volunteers;

  const skills = useMemo(
    () => [...new Set(volunteers.flatMap((volunteer) => volunteer.skills))].sort(),
    [volunteers],
  );

  const causes = useMemo(
    () => [...new Set(volunteers.flatMap((volunteer) => volunteer.causes))].sort(),
    [volunteers],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = volunteers.filter((volunteer) => {
      if (normalized) {
        const haystack = [volunteer.name, volunteer.email, ...volunteer.skills]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalized)) return false;
      }
      if (skill !== "all" && !volunteer.skills.includes(skill)) return false;
      if (cause !== "all" && !volunteer.causes.includes(cause as Volunteer["causes"][number]))
        return false;
      if (attentionOnly && !needsAttention(volunteer)) return false;
      return true;
    });

    return rows.sort((first, second) => {
      switch (sort) {
        case "hours":
          return second.hoursVerified - first.hoursVerified;
        case "attendance":
          return first.attendanceRate - second.attendanceRate;
        case "joined":
          return second.joinedAt.localeCompare(first.joinedAt);
        default:
          return first.name.localeCompare(second.name);
      }
    });
  }, [volunteers, query, skill, cause, attentionOnly, sort]);

  const selected =
    selectedId === "none"
      ? null
      : (filtered.find((volunteer) => volunteer.id === selectedId) ?? filtered[0] ?? null);

  const stats = useMemo(() => {
    const active = volunteers.filter((volunteer) => volunteer.status === "active").length;
    const reliable = volunteers.filter((volunteer) => volunteer.attendanceRate >= 95).length;
    const followUp = volunteers.filter(needsAttention).length;
    const hours = volunteers.reduce((total, volunteer) => total + volunteer.hoursVerified, 0);
    return { active, reliable, followUp, hours };
  }, [volunteers]);

  const nextShift = selected
    ? getUpcomingForVolunteer(selected.id, session, workspace)[0]
    : undefined;

  // A short readiness list, all read from records.
  const readiness = useMemo(() => {
    if (!selected) return [];
    const credentials = getCredentials(session, workspace).filter(
      (row) => row.volunteer.id === selected.id,
    );
    const expiring = credentials.find(
      (row) => row.status === "expiring" || row.status === "expired",
    );
    const rows: { ok: boolean; text: string }[] = [
      selected.status === "active"
        ? { ok: true, text: "Application approved" }
        : { ok: false, text: "Application still in progress" },
      selected.availability.length > 0
        ? { ok: true, text: "Availability added" }
        : { ok: false, text: "No availability on file" },
      selected.skills.length > 0
        ? { ok: true, text: `${selected.skills.length} skills on file` }
        : { ok: false, text: "No skills recorded" },
      expiring
        ? {
            ok: false,
            text: `${expiring.name} ${expiring.status === "expired" ? "expired" : "expires"}${
              expiring.expiresAt ? ` ${formatDate(expiring.expiresAt)}` : ""
            }`,
          }
        : { ok: true, text: "No credentials expiring" },
      nextShift
        ? { ok: true, text: `Upcoming shift ${formatDate(nextShift.shift.startsAt)}` }
        : { ok: false, text: "No upcoming shift" },
    ];
    return rows;
  }, [selected, session, workspace, nextShift]);

  function exportCsv() {
    const header = [
      "Name",
      "Email",
      "Phone",
      "Status",
      "Joined",
      "Skills",
      "Causes",
      "Verified hours",
      "Attendance %",
      "Events",
    ];
    const rows = filtered.map((volunteer) => [
      volunteer.name,
      volunteer.email,
      volunteer.phone,
      volunteer.status,
      volunteer.joinedAt,
      volunteer.skills.join("; "),
      volunteer.causes.join("; "),
      volunteer.hoursVerified,
      volunteer.attendanceRate,
      volunteer.eventsCompleted,
    ]);
    downloadCsv("civicflow-volunteers.csv", [header, ...rows]);
  }

  const columns: Column<Volunteer>[] = [
    {
      key: "name",
      header: "Volunteer",
      width: "30%",
      render: (volunteer) => (
        <div className={styles.personCell}>
          <Avatar
            initials={volunteer.initials}
            src={volunteer.photo || undefined}
            tone={volunteer.tone}
            size={30}
          />
          <div className={styles.personCopy}>
            <span className={styles.personName}>{volunteer.name}</span>
            <span className={styles.personEmail}>{volunteer.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      width: "10%",
      render: (volunteer) => (
        <span className={styles.muted}>{format(parseISO(volunteer.joinedAt), "MMM yyyy")}</span>
      ),
    },
    {
      key: "skills",
      header: "Skills",
      width: "24%",
      render: (volunteer) => (
        <div className={styles.skillCell}>
          {volunteer.skills.slice(0, 2).map((name) => (
            <span key={name} className={styles.skill}>
              {name}
            </span>
          ))}
          {volunteer.skills.length > 2 ? (
            <span className={styles.skillMore}>+{volunteer.skills.length - 2}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "hours",
      header: "Hours",
      align: "right",
      render: (volunteer) => (
        <span className={styles.hours}>{volunteer.hoursVerified.toFixed(1)}</span>
      ),
    },
    {
      key: "attendance",
      header: "Attendance",
      align: "right",
      render: (volunteer) => (
        <span
          className={
            volunteer.attendanceRate < 85 ? `${styles.rate} ${styles.rateLow}` : styles.rate
          }
        >
          {volunteer.attendanceRate}%
        </span>
      ),
    },
    {
      key: "events",
      header: "Events",
      align: "right",
      render: (volunteer) => <span className={styles.muted}>{volunteer.eventsCompleted}</span>,
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (volunteer) =>
        needsAttention(volunteer) ? (
          <Badge tone="amber" dot>
            Follow up
          </Badge>
        ) : (
          <Badge tone="green" dot>
            Active
          </Badge>
        ),
    },
  ];

  return (
    <Page>
      <WorkAreaTabs label="People" items={peopleTabs} />
      <PageHeader
        eyebrow="People"
        title="Volunteers"
        description="Every active volunteer, their skills, and where a coordinator should step in."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Download size={14} aria-hidden="true" />}
              onClick={exportCsv}
            >
              Export CSV
            </Button>
            <a
              className={styles.invite}
              href={`mailto:${workspace.organization.email}?subject=${encodeURIComponent(
                `Invitation to volunteer with ${workspace.organization.name}`,
              )}`}
            >
              <UserPlus size={14} aria-hidden="true" />
              Invite volunteer
            </a>
          </>
        }
      />

      <div className={styles.stats}>
        <StatCard
          icon={Users}
          value={stats.active}
          label="Active volunteers"
          tone="green"
          meta="Available to schedule"
        />
        <StatCard
          icon={ShieldCheck}
          value={stats.reliable}
          label="95%+ attendance"
          tone="cobalt"
          meta="Most reliable cohort"
        />
        <StatCard
          icon={AlertTriangle}
          value={stats.followUp}
          label="Need follow-up"
          tone="coral"
          meta="Low attendance or activity"
        />
        <StatCard
          icon={Clock3}
          value={Math.round(stats.hours).toLocaleString()}
          label="Verified volunteer hours"
          tone="violet"
          meta="All active records"
        />
      </div>

      <Card padding="compact" className={styles.directory}>
        <div className={styles.toolbar}>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search name, email, or skill…"
            label="Search volunteers"
          />
          <div className={styles.filters}>
            <select
              className={styles.select}
              aria-label="Filter by skill"
              value={skill}
              onChange={(event) => setSkill(event.target.value)}
            >
              <option value="all">All skills</option>
              {skills.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              aria-label="Filter by cause"
              value={cause}
              onChange={(event) => setCause(event.target.value)}
            >
              <option value="all">All causes</option>
              {causes.map((name) => (
                <option key={name} value={name}>
                  {CAUSE_LABELS[name]}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              aria-label="Sort volunteers"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              <option value="name">Name A–Z</option>
              <option value="hours">Most hours</option>
              <option value="attendance">Lowest attendance</option>
              <option value="joined">Newest first</option>
            </select>
            <button
              type="button"
              className={`${styles.filterToggle} ${attentionOnly ? styles.filterToggleOn : ""}`}
              aria-pressed={attentionOnly}
              onClick={() => setAttentionOnly((value) => !value)}
            >
              <AlertTriangle size={12} aria-hidden="true" />
              Needs attention
            </button>
          </div>
          <span className={styles.count}>
            {filtered.length} of {volunteers.length}
          </span>
        </div>

        <div className={styles.split}>
          <div className={styles.tableArea}>
            {filtered.length === 0 ? (
              <EmptyState
                title="No volunteers match those filters"
                copy="Clear the search or filters to see the full directory."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setSkill("all");
                      setCause("all");
                      setAttentionOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <>
                <DataTable
                  columns={columns}
                  rows={filtered.slice(0, limit)}
                  caption="Volunteer directory"
                  onRowClick={(volunteer) => setSelectedId(volunteer.id)}
                  className={styles.table}
                />
                <div className={styles.tableFooter}>
                  <span className={styles.muted}>
                    Showing {Math.min(limit, filtered.length)} of {filtered.length}
                  </span>
                  {limit < filtered.length ? (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => setLimit((value) => value + PAGE_SIZE)}
                    >
                      Show more
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </div>

          {selected ? (
            <aside className={styles.panel} aria-label={`Profile summary for ${selected.name}`}>
              <div className={styles.panelTop}>
                <Avatar
                  initials={selected.initials}
                  src={selected.photo || undefined}
                  tone={selected.tone}
                  size={48}
                />
                <button
                  type="button"
                  className={styles.panelClose}
                  aria-label="Close profile summary"
                  onClick={() => setSelectedId("none")}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <h2 className={styles.panelName}>{selected.name}</h2>
              <p className={styles.panelRole}>
                {selected.causes.map((value) => CAUSE_LABELS[value]).join(" · ")}
              </p>
              <div className={styles.panelBadges}>
                <Badge tone={needsAttention(selected) ? "amber" : "green"} dot>
                  {needsAttention(selected) ? "Follow up" : "Active"}
                </Badge>
                <Badge tone="neutral">
                  Joined {format(parseISO(selected.joinedAt), "MMM yyyy")}
                </Badge>
              </div>

              <div className={styles.panelMetrics}>
                <div>
                  <span className={styles.panelValue}>{selected.hoursVerified.toFixed(1)} h</span>
                  <span className={styles.panelLabel}>Verified</span>
                </div>
                <div>
                  <span className={styles.panelValue}>{selected.attendanceRate}%</span>
                  <span className={styles.panelLabel}>Attendance</span>
                </div>
                <div>
                  <span className={styles.panelValue}>{selected.eventsCompleted}</span>
                  <span className={styles.panelLabel}>Events</span>
                </div>
              </div>

              <div className={styles.panelSection}>
                <h3>Ready to schedule</h3>
                <ul className={styles.readiness}>
                  {readiness.map((row) => (
                    <li
                      key={row.text}
                      className={row.ok ? styles.readinessItem : styles.readinessWarn}
                    >
                      {row.ok ? (
                        <Check size={12} aria-hidden="true" />
                      ) : (
                        <AlertTriangle size={12} aria-hidden="true" />
                      )}
                      {row.text}
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.panelSection}>
                <h3>Skills</h3>
                <div className={styles.skillCell}>
                  {selected.skills.map((name) => (
                    <span key={name} className={styles.skill}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.panelSection}>
                <h3>Next shift</h3>
                {nextShift ? (
                  <div className={styles.nextShift}>
                    <span>{nextShift.opportunity.title}</span>
                    <span className={styles.muted}>
                      {formatDate(nextShift.shift.startsAt)} ·{" "}
                      {timeRange(nextShift.shift.startsAt, nextShift.shift.endsAt)}
                    </span>
                  </div>
                ) : (
                  <p className={styles.muted}>No upcoming shift. A good candidate for outreach.</p>
                )}
              </div>

              <div className={styles.panelSection}>
                <h3>Contact</h3>
                <a className={styles.contactLine} href={`mailto:${selected.email}`}>
                  <Mail size={13} aria-hidden="true" />
                  {selected.email}
                </a>
                <a
                  className={styles.contactLine}
                  href={`tel:${selected.phone.replace(/[^\d+]/g, "")}`}
                >
                  {selected.phone}
                </a>
              </div>

              <div className={styles.panelActions}>
                <ButtonLink
                  to={`/coordinator/volunteers/${selected.id}`}
                  variant="primary"
                  size="small"
                  icon={<ChevronRight size={13} aria-hidden="true" />}
                >
                  Full profile
                </ButtonLink>
                <Button
                  variant="secondary"
                  size="small"
                  icon={<Mail size={13} aria-hidden="true" />}
                  onClick={() => {
                    window.location.href = `mailto:${selected.email}?subject=${encodeURIComponent(
                      "Checking in from CivicFlow",
                    )}`;
                  }}
                >
                  Email
                </Button>
              </div>
              <p className={styles.panelFoot}>
                {formatHours(selected.hoursVerified)} verified · {selected.eventsCompleted} events
              </p>
            </aside>
          ) : null}
        </div>
      </Card>
    </Page>
  );
}
