import { useMemo, useState } from "react";
import { Download, FileDown, FileText, Filter, Save } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AreaChart,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  DonutChart,
  Page,
  PageHeader,
  SelectField,
  Tabs,
} from "../../components/ui";
import type { Column } from "../../components/ui";
import { currentDay, inRange, reportRange, type ReportPeriod } from "../../lib/workspace/dates";
import { useWorkspace } from "../../lib/workspace/session";
import { WorkAreaTabs } from "../../components/navigation/WorkAreaTabs";
import { reportTabs } from "../../app/workAreas";
import { getWorkspaceRepository } from "../../lib/workspace/repository";
import {
  CAUSE_LABELS,
  formatDate,
  formatMinutes,
  getCauseHours,
  getHourRows,
  REPORT_TEMPLATES,
} from "../../lib/workspace/selectors";
import type { HourRow } from "../../lib/workspace/selectors";
import styles from "./Reports.module.css";
import { messageOf } from "../../lib/errors";

const FIELD_OPTIONS = [
  { id: "volunteer", label: "Volunteer name" },
  { id: "program", label: "Program" },
  { id: "date", label: "Service date" },
  { id: "hours", label: "Approved duration" },
  { id: "status", label: "Status" },
  { id: "verification", label: "Verification ID" },
];

type Row = HourRow & { id: string };

export function buildTrendPoints(rows: HourRow[]): { label: string; value: number }[] {
  // ISO keys sort chronologically; display labels do not.
  const points = new Map<string, number>();
  for (const row of rows) {
    points.set(
      row.date,
      (points.get(row.date) ?? 0) + (row.approvedMinutes ?? row.requestedMinutes),
    );
  }
  return [...points.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-10)
    .map(([date, value]) => ({ label: formatDate(date), value }));
}

export function CustomReportPage() {
  const { workspace, session, actions } = useWorkspace();
  const [params] = useSearchParams();
  const template = REPORT_TEMPLATES.find((item) => item.id === params.get("template"));
  const [fields, setFields] = useState<string[]>([
    "volunteer",
    "program",
    "date",
    "hours",
    "status",
  ]);
  const [cause, setCause] = useState("all");
  const [range, setRange] = useState("month");
  const [chart, setChart] = useState("trend");
  const [grouping, setGrouping] = useState("none");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  const allRows = getHourRows(session, workspace);
  const selectedRange = useMemo(
    () => reportRange(workspace.now, range as ReportPeriod),
    [workspace.now, range],
  );
  const rows = useMemo<Row[]>(() => {
    return allRows
      .filter((row) => (cause === "all" ? true : row.opportunity.cause === cause))
      .filter((row) => inRange(row.date, selectedRange))
      .map((row) => ({ ...row, id: row.id }))
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 12);
  }, [allRows, cause, selectedRange]);

  const columns: Column<Row>[] = [];
  if (fields.includes("volunteer")) {
    columns.push({ key: "volunteer", header: "Volunteer", render: (row) => row.volunteer.name });
  }
  if (fields.includes("program")) {
    columns.push({ key: "program", header: "Program", render: (row) => row.opportunity.title });
  }
  if (fields.includes("date")) {
    columns.push({ key: "date", header: "Date", render: (row) => formatDate(row.date) });
  }
  if (fields.includes("hours")) {
    columns.push({
      key: "hours",
      header: "Approved",
      align: "right",
      render: (row) => formatMinutes(row.approvedMinutes ?? row.requestedMinutes),
    });
  }
  if (fields.includes("status")) {
    columns.push({
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge
          tone={row.status === "verified" ? "green" : row.status === "pending" ? "amber" : "red"}
          dot
        >
          {row.status}
        </Badge>
      ),
    });
  }
  if (fields.includes("verification")) {
    columns.push({
      key: "verification",
      header: "Verification",
      render: (row) => row.verificationId ?? "—",
    });
  }

  async function exportReport(format: "csv" | "pdf") {
    setError("");
    setSaved("");
    const end = currentDay(workspace.now);
    const periodRange = reportRange(workspace.now, range as ReportPeriod);
    const dateStart = periodRange ? periodRange.start : `${end.slice(0, 4)}-01-01`;
    try {
      const receipt = await getWorkspaceRepository().exportReport(
        {
          template: (template?.id ?? "report-custom").replace("report-", ""),
          fields,
          dateStart,
          dateEnd: end,
          cause: cause === "all" ? null : cause,
          groupBy: grouping as "none" | "cause" | "program",
        },
        format,
      );
      if (!receipt) {
        setSaved("Export canceled. Nothing was written.");
        return;
      }
      setSaved(
        format === "pdf" && receipt.path === "print-dialog"
          ? "Printable report opened. Choose Save as PDF in the print dialog."
          : `Exported ${receipt.title} (${receipt.format.toUpperCase()}) to ${receipt.path}.`,
      );
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <Page>
      <WorkAreaTabs label="Reports" items={reportTabs} />
      <PageHeader
        eyebrow="Reporting"
        title={template ? template.title : "Custom report builder"}
        description={
          template
            ? template.description
            : "Build a report from validated fields. No raw SQL, and nothing leaves this device."
        }
        backTo="/coordinator/reports"
        backLabel="Reports"
        actions={
          <>
            <ButtonLink
              to="/coordinator/reports/preview"
              variant="secondary"
              icon={<FileText size={14} />}
            >
              Report preview
            </ButtonLink>
            <Button
              variant="secondary"
              icon={<FileDown size={14} />}
              onClick={() => void exportReport("pdf")}
            >
              Export PDF
            </Button>
            <Button
              variant="primary"
              icon={<Download size={14} />}
              onClick={() => void exportReport("csv")}
            >
              Export CSV
            </Button>
          </>
        }
      />

      <div className={styles.builder}>
        <Card className={styles.builderRail}>
          <h2 className={styles.railTitle}>Fields</h2>
          <div className={styles.fieldList}>
            {FIELD_OPTIONS.map((field) => (
              <label className={styles.fieldOption} key={field.id}>
                <input
                  type="checkbox"
                  checked={fields.includes(field.id)}
                  onChange={(event) =>
                    setFields((current) =>
                      event.target.checked
                        ? [...current, field.id]
                        : current.filter((item) => item !== field.id),
                    )
                  }
                />
                {field.label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <SelectField
              label="Group rows by"
              value={grouping}
              onChange={(event) => setGrouping(event.target.value)}
            >
              <option value="none">No grouping</option>
              <option value="cause">Cause</option>
              <option value="program">Program</option>
            </SelectField>
          </div>
          <p className={styles.tableNote}>
            {fields.length} field{fields.length === 1 ? "" : "s"} selected · {rows.length} preview
            rows
          </p>
        </Card>

        <Card className={styles.canvas}>
          <div className={styles.paper}>
            <div className={styles.paperHeader}>
              <div>
                <h2 className={styles.paperTitle}>Preview</h2>
                <p className={styles.paperMeta}>
                  {workspace.organization.name} · generated {workspace.now.slice(0, 10)}
                </p>
              </div>
              <Badge tone="cobalt">Local data</Badge>
            </div>

            <div style={{ marginTop: 14 }}>
              <Tabs
                items={[
                  { id: "trend", label: "Hours trend" },
                  { id: "cause", label: "By cause" },
                  { id: "table", label: "Table only" },
                ]}
                value={chart}
                onChange={setChart}
                label="Preview chart"
              />
            </div>

            <div style={{ marginTop: 14, minHeight: 176 }}>
              {chart === "trend" ? (
                <AreaChart
                  data={buildTrendPoints(
                    getHourRows(session, workspace)
                      .filter((row) => (cause === "all" ? true : row.opportunity.cause === cause))
                      .filter((row) => inRange(row.date, selectedRange)),
                  )}
                  height={176}
                  label="Hours trend preview"
                  formatValue={(value) => formatMinutes(value)}
                />
              ) : null}
              {chart === "cause" ? (
                <DonutChart
                  data={getCauseHours(session, workspace).map((item) => ({
                    label: item.label,
                    value: item.hours,
                    color:
                      item.cause === "food"
                        ? "var(--color-coral)"
                        : item.cause === "education"
                          ? "var(--color-violet)"
                          : item.cause === "environment"
                            ? "var(--color-teal)"
                            : "var(--color-orange)",
                  }))}
                  centerValue={`${getCauseHours(session, workspace).length}`}
                  centerLabel="causes"
                  label="Cause preview"
                />
              ) : null}
              {chart === "table" ? (
                <p className={styles.tableNote}>Table-only preview is shown below.</p>
              ) : null}
            </div>

            <div style={{ marginTop: 16 }}>
              {grouping !== "none" ? (
                <p className={styles.tableNote}>
                  Grouped by {grouping}; header values are repeated per row so CSV exports stay
                  machine-readable.
                </p>
              ) : null}
              <DataTable
                columns={columns}
                rows={rows}
                caption="Report preview"
                empty="No data matches these filters."
              />
            </div>
          </div>
        </Card>

        <Card className={styles.builderRail}>
          <h2 className={styles.railTitle}>
            <Filter size={14} aria-hidden="true" style={{ marginRight: 5 }} />
            Filters
          </h2>
          <div className={styles.filters}>
            <SelectField
              label="Date range"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              <option value="month">This month</option>
              <option value="week">Last 7 days</option>
              <option value="year">Year to date</option>
            </SelectField>
            <SelectField
              label="Cause"
              value={cause}
              onChange={(event) => setCause(event.target.value)}
            >
              <option value="all">All causes</option>
              {Object.entries(CAUSE_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </SelectField>
            <div>
              <span className={styles.tableNote}>Quick filters</span>
              <div className={styles.chipGrid} style={{ marginTop: 6 }}>
                {["food", "education", "environment"].map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={styles.fieldOption}
                    onClick={() => setCause(cause === id ? "all" : id)}
                    style={{
                      height: 26,
                      padding: "0 9px",
                      borderRadius: 99,
                      border: "1px solid var(--border-soft)",
                      background: cause === id ? "var(--color-navy)" : "var(--surface-raised)",
                      color: cause === id ? "#fff" : "var(--text-secondary)",
                    }}
                  >
                    {CAUSE_LABELS[id as keyof typeof CAUSE_LABELS]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
            <Button
              variant="secondary"
              size="small"
              icon={<Save size={12} />}
              onClick={() => {
                void (async () => {
                  try {
                    const name = template?.title ?? "Custom view";
                    await actions.saveReportView(
                      name,
                      "reports",
                      JSON.stringify({
                        fields,
                        cause,
                        range,
                        grouping,
                        template: template?.id ?? null,
                      }),
                    );
                    setSaved(
                      `Saved “${name}” with ${fields.length} fields and ${rows.length} rows.`,
                    );
                    setError("");
                  } catch (caught) {
                    setError(messageOf(caught));
                  }
                })();
              }}
            >
              Save this view
            </Button>
            <Link to="/coordinator/reports" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              Back to templates
            </Link>
          </div>
          {error ? (
            <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--tone-red-ink)" }} role="alert">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p
              style={{ marginTop: 8, fontSize: 12.5, color: "var(--tone-green-ink)" }}
              role="status"
            >
              {saved}
            </p>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
