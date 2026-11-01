import { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  TextareaField,
  statusLabel,
  statusTone,
} from "../../components/ui";
import type { Column } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useWorkspace } from "../../lib/workspace/session";
import type { VolunteerImportPreview, VolunteerImportRow } from "../../types/domain";
import { messageOf } from "../../lib/errors";

type CheckedRow = VolunteerImportRow & { id: string };

/**
 * Rows are checked before anything is written; a file with any problem is
 * refused whole, with the line the person sees in their editor.
 */
export function VolunteerImportCard() {
  const { actions } = useWorkspace();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<VolunteerImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // The column list and the example row come from the importer itself, so this
  // screen never restates a header the file has to use.
  useEffect(() => {
    let active = true;
    actions
      .previewVolunteerImport("")
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [actions]);

  async function check(next: string) {
    setError("");
    setDone("");
    setBusy(true);
    try {
      setPreview(await actions.previewVolunteerImport(next));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    setText(content);
    await check(content);
  }

  async function runImport() {
    setError("");
    setDone("");
    setBusy(true);
    try {
      const summary = await actions.applyVolunteerImport(text);
      setDone(
        `${summary.created} volunteer${summary.created === 1 ? "" : "s"} added to the roster.`,
      );
      setText("");
      setPreview(await actions.previewVolunteerImport(""));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function exportRoster() {
    setError("");
    setDone("");
    setBusy(true);
    try {
      const receipt = await actions.exportVolunteerRoster();
      if (receipt) setDone(`Roster written to ${receipt.path}.`);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const rows: CheckedRow[] = (preview?.rows ?? []).map((row) => ({
    ...row,
    id: `line-${row.line}`,
  }));

  const columns: Column<CheckedRow>[] = [
    {
      key: "line",
      header: t("Line"),
      width: "64px",
      render: (row) => <span className="tabular">{row.line}</span>,
    },
    {
      key: "person",
      header: t("Volunteer"),
      render: (row) => (
        <span>
          <span style={{ display: "block" }}>{row.name || t("No name given")}</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
            {row.email || t("No email given")}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: t("Status"),
      render: (row) => (
        <Badge tone={statusTone(row.status)} dot>
          {statusLabel(row.status)}
        </Badge>
      ),
    },
    {
      key: "skills",
      header: t("Skills"),
      render: (row) => row.skills.join(", ") || t("None yet"),
    },
    {
      key: "availability",
      header: t("Availability"),
      render: (row) => row.availability.join(", ") || t("None yet"),
    },
    {
      key: "outcome",
      header: t("Outcome"),
      render: (row) => (
        <span style={{ display: "block", fontSize: 12.5 }}>
          {row.outcome === "create" ? (
            <span style={{ color: "var(--tone-green-ink)", fontWeight: 560 }}>
              {t("Will be added")}
            </span>
          ) : (
            <span style={{ color: "var(--tone-amber-ink)", fontWeight: 560 }}>
              {t("Needs a fix")}
            </span>
          )}
          {[...row.problems, ...row.notes].map((note) => (
            <span
              key={note}
              style={{ display: "block", color: "var(--text-muted)", lineHeight: 1.45 }}
            >
              {note}
            </span>
          ))}
        </span>
      ),
    },
  ];

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 590 }}>{t("Import a volunteer spreadsheet")}</div>
      <p style={{ marginTop: 3, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {t(
          "A CSV file whose first row names the columns. Every row is checked before anything is written, and a file with any problem is refused whole, so the roster never ends up half imported.",
        )}
      </p>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginTop: 10,
        }}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label={t("Choose a volunteer CSV file")}
          style={{ fontSize: 12.5, color: "var(--text-muted)", maxWidth: 260 }}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <Button
          variant="secondary"
          size="small"
          icon={<FileSpreadsheet size={13} />}
          disabled={busy}
          onClick={() => {
            const template = preview?.template ?? "";
            setText(template);
            void check(template);
          }}
        >
          {t("Fill with the template")}
        </Button>
        <Button
          variant="secondary"
          size="small"
          icon={<Download size={13} />}
          disabled={busy}
          onClick={() => void exportRoster()}
        >
          {t("Export the roster")}
        </Button>
      </div>

      <div style={{ marginTop: 12, maxWidth: 620 }}>
        <TextareaField
          label={t("Or paste the rows")}
          hint={t("The header row must name {columns}.", {
            columns: (preview?.required ?? []).join(" and "),
          })}
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <Button
          variant="secondary"
          icon={<FileSpreadsheet size={13} />}
          disabled={busy || text.trim().length === 0}
          onClick={() => void check(text)}
        >
          {t("Check the file")}
        </Button>
        <Button
          variant="primary"
          disabled={busy || !preview || preview.invalid > 0 || preview.valid === 0}
          onClick={() => void runImport()}
        >
          {preview && preview.valid > 0
            ? t("Add {count} volunteers", { count: preview.valid })
            : t("Add the volunteers")}
        </Button>
      </div>

      {preview && preview.total > 0 ? (
        <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)" }} role="status">
          {t("{total} rows read · {valid} ready · {invalid} need a fix", {
            total: preview.total,
            valid: preview.valid,
            invalid: preview.invalid,
          })}
        </p>
      ) : null}

      {preview && preview.problems.length > 0 ? (
        <ul
          role="alert"
          style={{
            marginTop: 8,
            paddingLeft: 18,
            fontSize: 12.5,
            color: "var(--tone-amber-ink)",
            lineHeight: 1.5,
          }}
        >
          {preview.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {rows.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <DataTable
            columns={columns}
            rows={rows}
            caption={t("Rows read from the file")}
            empty={t("No rows read yet.")}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={{ marginTop: 8, fontSize: 12.5, color: "var(--tone-amber-ink)" }}>
          {error}
        </p>
      ) : null}
      {done ? (
        <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--tone-green-ink)" }} role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}
