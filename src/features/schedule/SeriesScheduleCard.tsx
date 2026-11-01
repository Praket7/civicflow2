import { useState } from "react";
import { CalendarPlus, Repeat } from "lucide-react";
import { Badge, Button, ButtonLink, Card, SectionHeader, TextField } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useWorkspace } from "../../lib/workspace/session";
import type {
  Opportunity,
  RecurrenceRule,
  SeriesRole,
  ShiftSeriesRecord,
} from "../../types/domain";
import styles from "./SeriesSchedule.module.css";
import { messageOf } from "../../lib/errors";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/** "General support x 4" per line, which is how a coordinator writes a roster. */
function parseRoles(text: string): SeriesRole[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(.*?)\s*[x×]\s*(\d+)$/i.exec(line);
      if (!match) throw new Error(t("Write each role as Name x Count, one per line."));
      return { name: match[1].trim(), required: Number(match[2]) };
    });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The series owns its rule and the shifts it generates; a later edit reaches
 * exactly those instances.
 */
export function SeriesScheduleCard({ opportunity }: { opportunity: Opportunity }) {
  const { actions } = useWorkspace();
  const [everyWeek, setEveryWeek] = useState(true);
  const [intervalWeeks, setIntervalWeeks] = useState("1");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startsOn, setStartsOn] = useState(() => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    return isoDate(next);
  });
  const [startsLocalTime, setStartsLocalTime] = useState("09:00");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [endMode, setEndMode] = useState<"count" | "date">("count");
  const [occurrenceCount, setOccurrenceCount] = useState("8");
  const [endsOn, setEndsOn] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 56);
    return isoDate(end);
  });
  const [roles, setRoles] = useState(`General support x ${opportunity.capacity}`);
  const [created, setCreated] = useState<ShiftSeriesRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function toggleWeekday(value: number) {
    setWeekdays((current) =>
      current.includes(value)
        ? current.filter((day) => day !== value)
        : [...current, value].sort((a, b) => a - b),
    );
  }

  async function schedule() {
    setBusy(true);
    setError("");
    try {
      const rule: RecurrenceRule = {
        kind: everyWeek ? "weekly" : "none",
        intervalWeeks: Number(intervalWeeks) || 1,
        weekdays: everyWeek ? weekdays : [],
        startsLocalTime,
        durationMinutes: Number(durationMinutes) || 120,
        startsOn,
        endsOn: endMode === "date" ? endsOn : null,
        occurrenceCount: endMode === "count" ? Number(occurrenceCount) || 1 : null,
      };
      setCreated(await actions.createShiftSeries(opportunity.id, rule, parseRoles(roles)));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={styles.card} ariaLabel={t("Schedule repeating shifts")}>
      <SectionHeader
        title="Schedule repeating shifts"
        subtitle={t("A weekly series stores the rule once and generates every shift it describes.")}
        action={
          created ? (
            <Badge tone="green" dot>
              {t(created.generated === 1 ? "{count} shift scheduled" : "{count} shifts scheduled", {
                count: created.generated,
              })}
            </Badge>
          ) : null
        }
      />

      {created ? (
        <div className={styles.done}>
          <p>
            <Repeat size={13} aria-hidden="true" />
            {t("{title} now repeats: {hours}.", {
              title: created.opportunityTitle,
              hours: t("{count} minutes", { count: created.durationMinutes }),
            })}
          </p>
          <div className={styles.actions}>
            <ButtonLink to="/coordinator/schedule" variant="secondary" size="small">
              {t("Open schedule")}
            </ButtonLink>
            <Button variant="ghost" size="small" onClick={() => setCreated(null)}>
              {t("Schedule another")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.repeat}>
            <Button
              variant={everyWeek ? "primary" : "secondary"}
              size="small"
              onClick={() => setEveryWeek(true)}
            >
              {t("Repeats weekly")}
            </Button>
            <Button
              variant={everyWeek ? "secondary" : "primary"}
              size="small"
              onClick={() => setEveryWeek(false)}
            >
              {t("One shift only")}
            </Button>
          </div>

          {everyWeek ? (
            <>
              <div className={styles.days} role="group" aria-label={t("Days of the week")}>
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    className={`${styles.day} ${weekdays.includes(day.value) ? styles.dayOn : ""}`}
                    aria-pressed={weekdays.includes(day.value)}
                    onClick={() => toggleWeekday(day.value)}
                  >
                    {t(day.label)}
                  </button>
                ))}
              </div>
              <div className={styles.grid}>
                <TextField
                  label={t("Every N weeks")}
                  value={intervalWeeks}
                  onChange={(event) => setIntervalWeeks(event.target.value)}
                  inputMode="numeric"
                />
                <TextField
                  label={t("Starts on")}
                  type="date"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </div>
            </>
          ) : (
            <div className={styles.grid}>
              <TextField
                label={t("Shift date")}
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </div>
          )}

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
              onChange={(event) => setDurationMinutes(event.target.value)}
              inputMode="numeric"
            />
          </div>

          {everyWeek ? (
            <div className={styles.repeat}>
              <Button
                variant={endMode === "count" ? "primary" : "secondary"}
                size="small"
                onClick={() => setEndMode("count")}
              >
                {t("Ends after N shifts")}
              </Button>
              <Button
                variant={endMode === "date" ? "primary" : "secondary"}
                size="small"
                onClick={() => setEndMode("date")}
              >
                {t("Ends on a date")}
              </Button>
            </div>
          ) : null}

          <div className={styles.grid}>
            {endMode === "count" && everyWeek ? (
              <TextField
                label={t("Shifts in the series")}
                value={occurrenceCount}
                onChange={(event) => setOccurrenceCount(event.target.value)}
                inputMode="numeric"
              />
            ) : (
              <TextField
                label={t("Ends on")}
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            )}
          </div>

          <label className={styles.roles}>
            <span>{t("Roles, one per line as Name x Count")}</span>
            <textarea value={roles} rows={3} onChange={(event) => setRoles(event.target.value)} />
          </label>

          <div className={styles.actions}>
            <Button
              variant="primary"
              icon={<CalendarPlus size={14} />}
              disabled={busy || (everyWeek && weekdays.length === 0)}
              onClick={() => void schedule()}
            >
              {busy ? t("Scheduling…") : t("Schedule the series")}
            </Button>
            {everyWeek && weekdays.length === 0 ? (
              <span className={styles.hint}>{t("Choose at least one day.")}</span>
            ) : null}
          </div>
        </>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
