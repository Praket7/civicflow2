import { useState } from "react";
import { CalendarPlus, Clock3, Repeat, Trash2 } from "lucide-react";
import { Badge, Button, Card, SectionHeader, TextField } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useShiftSeries } from "../../lib/workspace/queries";
import { useWorkspace } from "../../lib/workspace/session";
import type { ShiftSeriesRecord } from "../../types/domain";
import styles from "./SeriesSchedule.module.css";
import { messageOf } from "../../lib/errors";

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

/** The rule in the words a coordinator set it in, not the columns it lives in. */
function ruleSentence(record: ShiftSeriesRecord): string {
  if (record.kind !== "weekly") {
    return t("One shift, with no repeat rule.");
  }
  const every =
    record.intervalWeeks === 1
      ? t("Every week")
      : t("Every {count} weeks", { count: record.intervalWeeks });
  const days = record.weekdays.map((day) => t(WEEKDAY_LABELS[day] ?? "")).join(", ");
  const end =
    record.occurrenceCount !== null
      ? t("Ends after {count} shifts", { count: record.occurrenceCount })
      : record.endsOn !== null
        ? t("Ends on {date}", { date: record.endsOn })
        : t("No end date");
  return `${every} on ${days} · ${record.startsLocalTime} · ${t("{count} minutes", {
    count: record.durationMinutes,
  })} · ${end}`;
}

/**
 * Each series owns the shifts it generated, so edits and top-ups reach exactly
 * those instances.
 */
export function SeriesManagerCard() {
  const { actions } = useWorkspace();
  const { data: series = [], error: readError } = useShiftSeries();
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState("");
  const [startsLocalTime, setStartsLocalTime] = useState("09:00");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [scope, setScope] = useState<"instance" | "series">("series");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Every action writes a snapshot, and the session provider drops the cached
  // read models when that happens, so the list below is never a stale rule.
  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setNotice("");
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  if (series.length === 0) return null;

  return (
    <Card padding="compact" className={styles.manager} ariaLabel={t("Repeating series")}>
      <SectionHeader
        title={t("Repeating series")}
        subtitle={t(
          "Each rule owns the shifts it generated, so a change lands where it was meant.",
        )}
        action={
          <Badge tone="neutral" dot>
            {t(series.length === 1 ? "{count} series" : "{count} series", { count: series.length })}
          </Badge>
        }
      />
      <ul className={styles.seriesList}>
        {series.map((record) => (
          <li key={record.id} className={styles.seriesRow}>
            <div className={styles.seriesHead}>
              <span className={styles.seriesTitle}>
                <Repeat size={13} aria-hidden="true" />
                {record.opportunityTitle}
              </span>
              <Badge tone={record.generated > 0 ? "green" : "amber"} dot>
                {t("{count} shifts scheduled", { count: record.generated })}
              </Badge>
            </div>
            <p className={styles.seriesRule}>{ruleSentence(record)}</p>
            <p className={styles.seriesRoles}>
              {record.roles.map((role) => `${role.name} × ${role.required}`).join(" · ")}
            </p>
            <div className={styles.seriesActions}>
              <Button
                size="small"
                variant="secondary"
                icon={<CalendarPlus size={12} aria-hidden="true" />}
                disabled={busy !== ""}
                onClick={() =>
                  void run(record.id, async () => {
                    const added = await actions.generateSeriesInstances(record.id);
                    setNotice(
                      t(
                        added === 1
                          ? "Added {count} missing shift."
                          : "Added {count} missing shifts.",
                        { count: added },
                      ),
                    );
                  })
                }
              >
                {t("Add missing shifts")}
              </Button>
              <Button
                size="small"
                variant="ghost"
                icon={<Clock3 size={12} aria-hidden="true" />}
                disabled={busy !== ""}
                onClick={() => {
                  setEditing(editing === record.id ? "" : record.id);
                  setStartsLocalTime(record.startsLocalTime);
                  setDurationMinutes(String(record.durationMinutes));
                  setScope("series");
                }}
              >
                {editing === record.id ? t("Close") : t("Change the time")}
              </Button>
              <Button
                size="small"
                variant="ghost"
                icon={<Trash2 size={12} aria-hidden="true" />}
                disabled={busy !== ""}
                onClick={() =>
                  void run(record.id, async () => {
                    await actions.deleteShiftSeries(record.id);
                    setNotice(
                      t("Removed {title} and the shifts it generated.", {
                        title: record.opportunityTitle,
                      }),
                    );
                  })
                }
              >
                {t("Remove series")}
              </Button>
            </div>
            {editing === record.id ? (
              <div className={styles.seriesEditor}>
                <div className={styles.grid}>
                  <TextField
                    label={t("Starts at")}
                    type="time"
                    value={startsLocalTime}
                    onChange={(event) => setStartsLocalTime(event.target.value)}
                  />
                  <TextField
                    label={t("Minutes")}
                    value={durationMinutes}
                    inputMode="numeric"
                    onChange={(event) => setDurationMinutes(event.target.value)}
                  />
                </div>
                <div className={styles.repeat}>
                  <Button
                    size="small"
                    variant={scope === "series" ? "primary" : "secondary"}
                    onClick={() => setScope("series")}
                  >
                    {t("Every shift in the series")}
                  </Button>
                  <Button
                    size="small"
                    variant={scope === "instance" ? "primary" : "secondary"}
                    onClick={() => setScope("instance")}
                  >
                    {t("The next shift only")}
                  </Button>
                </div>
                <Button
                  size="small"
                  variant="primary"
                  disabled={busy !== ""}
                  onClick={() =>
                    void run(record.id, async () => {
                      await actions.retimeShiftSeries(
                        record.id,
                        startsLocalTime,
                        Number(durationMinutes) || record.durationMinutes,
                        scope,
                      );
                      setEditing("");
                      setNotice(
                        scope === "instance"
                          ? t("Moved the next shift of {title}.", {
                              title: record.opportunityTitle,
                            })
                          : t("Moved every shift in {title}.", {
                              title: record.opportunityTitle,
                            }),
                      );
                    })
                  }
                >
                  {t("Save the time")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {error || readError ? (
        <p className={styles.error} role="alert">
          {error || messageOf(readError)}
        </p>
      ) : null}
    </Card>
  );
}
