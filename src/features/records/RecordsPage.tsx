import { useMemo, useState } from "react";
import { CalendarDays, Clock3, Download, FileCheck2, FolderOpen, Users } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  Page,
  PageHeader,
  SearchField,
  Tabs,
  statusLabel,
  statusTone,
} from "../../components/ui";
import type { Column } from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { useWorkspace } from "../../lib/workspace/session";
import { WorkAreaTabs } from "../../components/navigation/WorkAreaTabs";
import { peopleTabs } from "../../app/workAreas";
import { formatDate, formatMinutes, getShiftRows, timeRange } from "../../lib/workspace/selectors";
import styles from "./Records.module.css";

type Kind = "volunteer" | "shift" | "hours" | "verification";

interface RecordRow {
  id: string;
  kind: Kind;
  title: string;
  subject: string;
  date: string;
  dateLabel: string;
  status: string;
  value: string;
  href: string;
  search: string;
}

const KIND_ICON = {
  volunteer: Users,
  shift: CalendarDays,
  hours: Clock3,
  verification: FileCheck2,
};

const KIND_LABEL: Record<Kind, string> = {
  volunteer: "Volunteer",
  shift: "Shift",
  hours: "Hours",
  verification: "Verification",
};

export function RecordsPage() {
  const { workspace, session } = useWorkspace();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);

  const rows = useMemo<RecordRow[]>(() => {
    const volunteerRows: RecordRow[] = workspace.volunteers.map((volunteer) => ({
      id: `vol-${volunteer.id}`,
      kind: "volunteer",
      title: volunteer.name,
      subject: `${volunteer.skills.slice(0, 2).join(", ")} · joined ${volunteer.joinedAt}`,
      date: volunteer.joinedAt,
      dateLabel: volunteer.joinedAt,
      status: volunteer.status,
      value: `${volunteer.hoursVerified.toFixed(1)} h`,
      href: `/coordinator/volunteers/${volunteer.id}`,
      search: `${volunteer.name} ${volunteer.email} ${volunteer.skills.join(" ")} ${volunteer.status}`,
    }));

    const shiftRows: RecordRow[] = getShiftRows(workspace).map((row) => ({
      id: `shift-${row.shift.id}`,
      kind: "shift",
      title: row.opportunity.title,
      subject: row.shift.roles
        .map((role) => `${role.name} ${role.filled}/${role.required}`)
        .join(" · "),
      date: row.shift.startsAt,
      dateLabel: `${formatDate(row.shift.startsAt)} · ${timeRange(row.shift.startsAt, row.shift.endsAt)}`,
      status: row.shift.roles.some((role) => role.filled < role.required) ? "role gap" : "covered",
      value: `${row.shift.confirmed}/${row.shift.capacity}`,
      href: `/coordinator/shifts/${row.shift.id}`,
      search: `${row.opportunity.title} ${row.opportunity.cause} ${row.opportunity.coordinator} shift`,
    }));

    const hourRows: RecordRow[] = [...workspace.hourEntries, ...workspace.mayaEntries].map(
      (entry) => {
        const volunteer =
          workspace.volunteers.find((person) => person.id === entry.volunteerId) ??
          workspace.volunteers[0];
        const opportunity =
          workspace.opportunities.find((item) => item.id === entry.opportunityId) ??
          workspace.opportunities[0];
        const decision = session.hoursDecisions[entry.id];
        return {
          id: `hours-${entry.id}`,
          kind: entry.verificationId ? "verification" : "hours",
          title: volunteer.name,
          subject: opportunity.title,
          date: entry.date,
          dateLabel: formatDate(entry.date),
          status: decision?.status ?? entry.status,
          value: formatMinutes(decision?.approvedMinutes ?? entry.minutes),
          href: `/coordinator/volunteers/${volunteer.id}`,
          search: `${volunteer.name} ${opportunity.title} ${entry.status} ${entry.verificationId ?? ""}`,
        };
      },
    );

    return [...volunteerRows, ...shiftRows, ...hourRows].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }, [session.hoursDecisions, workspace]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (tab === "verifications") return row.kind === "verification";
        if (tab !== "all") return row.kind === tab;
        return true;
      })
      .filter((row) => (normalized ? row.search.toLowerCase().includes(normalized) : true));
  }, [query, rows, tab]);

  const counts = {
    all: rows.length,
    volunteer: rows.filter((row) => row.kind === "volunteer").length,
    shift: rows.filter((row) => row.kind === "shift").length,
    hours: rows.filter((row) => row.kind === "hours").length,
    verifications: rows.filter((row) => row.kind === "verification").length,
  };

  function exportCsv() {
    const rows = filtered.map((row) => [
      KIND_LABEL[row.kind],
      row.title,
      row.subject,
      row.dateLabel,
      row.status,
      row.value,
    ]);
    downloadCsv("civicflow-records.csv", [
      ["Type", "Name", "Detail", "Date", "Status", "Value"],
      ...rows,
    ]);
  }

  const columns: Column<RecordRow>[] = [
    {
      key: "record",
      header: "Record",
      render: (row) => {
        const Icon = KIND_ICON[row.kind];
        return (
          <div className={styles.recordCell}>
            <span className={styles.recordIcon} aria-hidden="true">
              <Icon size={13} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className={styles.recordTitle} style={{ display: "block" }}>
                {row.title}
              </span>
              <span className={styles.recordSub} style={{ display: "block" }}>
                {row.subject}
              </span>
            </span>
          </div>
        );
      },
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <Badge tone="neutral">{KIND_LABEL[row.kind]}</Badge>,
    },
    {
      key: "date",
      header: "Date",
      render: (row) => <span className="tabular">{row.dateLabel}</span>,
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
      key: "value",
      header: "Value",
      align: "right",
      render: (row) => <span className="tabular">{row.value}</span>,
    },
    {
      key: "open",
      header: "",
      align: "right",
      render: (row) => (
        <Link to={row.href} style={{ fontSize: 12.5, color: "var(--action-primary)" }}>
          Open
        </Link>
      ),
    },
  ];

  return (
    <Page>
      <WorkAreaTabs label="People" items={peopleTabs} />
      <PageHeader
        eyebrow="Records"
        title="Records"
        description="One searchable ledger for volunteers, shifts, approved hours, and verification codes."
        actions={
          <>
            <Button variant="secondary" icon={<Download size={14} />} onClick={exportCsv}>
              Export CSV
            </Button>
            <ButtonLink to="/coordinator/audit" variant="primary" icon={<FolderOpen size={14} />}>
              Audit log
            </ButtonLink>
          </>
        }
      />

      <Card padding="compact">
        <div className={styles.tabsRow}>
          <Tabs
            items={[
              { id: "all", label: "All records", count: counts.all },
              { id: "volunteer", label: "Volunteers", count: counts.volunteer },
              { id: "shift", label: "Shifts", count: counts.shift },
              { id: "hours", label: "Hours", count: counts.hours },
              { id: "verifications", label: "Verifications", count: counts.verifications },
            ]}
            value={tab}
            onChange={(value) => {
              setTab(value);
              setLimit(20);
            }}
            label="Records type"
          />
          <div className={styles.toolbar}>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search any record…"
              label="Search records"
            />
            <Badge tone="neutral">{filtered.length} results</Badge>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {session.savedViews.map((view) => {
            let filters: Record<string, string[] | undefined>;
            try {
              filters = JSON.parse(view.filtersJson) as Record<string, string[] | undefined>;
            } catch {
              filters = {};
            }
            const value = filters.causes?.[0] ?? filters.skills?.[0] ?? view.name;
            const active = query.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={view.id}
                type="button"
                className={`${styles.viewChip} ${active ? styles.viewChipActive : ""}`}
                onClick={() => setQuery(active ? "" : value)}
              >
                {view.name}
              </button>
            );
          })}
          {query ? (
            <button type="button" className={styles.viewChip} onClick={() => setQuery("")}>
              Clear search
            </button>
          ) : null}
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={filtered.slice(0, limit)}
        caption={`${filtered.length} records`}
        empty="No records match this search. Try a volunteer name, program, or verification code."
      />

      {filtered.length > limit ? (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Button variant="secondary" onClick={() => setLimit((value) => value + 25)}>
            Show 25 more records
          </Button>
        </div>
      ) : null}
    </Page>
  );
}
