import { CalendarClock, ChevronDown, MapPin, Wand2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import { Button, ButtonLink, EmptyState } from "../../components/ui";
import { t } from "../../lib/i18n";
import { formatDate, timeRange } from "../../lib/workspace/selectors";
import styles from "./AutoRosterPage.module.css";
import { CandidatePane } from "./CandidatePane";
import { PlanPane } from "./PlanPane";
import { RequirementsPane } from "./RequirementsPane";
import { useAutoRoster } from "./useAutoRoster";

export function AutoRosterPage() {
  const model = useAutoRoster();
  const {
    scope,
    setScope,
    weekRows,
    upcoming,
    selectedShiftId,
    setShiftId,
    activeRows,
    planning,
    generatePlan,
    scopeStart,
    scopeEnd,
    requiredSlots,
    filledSlots,
    invalidatePlan,
  } = model;

  if (!selectedShiftId || activeRows.length === 0) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Every shift is fully staffed"
          copy="There are no role gaps in the upcoming schedule. New shifts appear here as soon as a role opens."
          action={<ButtonLink to="/coordinator/schedule">Open schedule</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <nav className={styles.crumb} aria-label="Breadcrumb">
          <Link to="/coordinator/mission-control">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">AutoRoster</span>
        </nav>
        <div className={styles.titleRow}>
          <div className={styles.titleCopy}>
            <h1 className={styles.title}>AutoRoster</h1>
            <p className={styles.lede}>
              Staff the open roles across the next seven days from people already on your books. The
              optimizer weighs skills, availability, clashes, and how often someone turns up.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Button
              className={styles.optimizeButton}
              onClick={() => void generatePlan()}
              disabled={planning}
              icon={<Wand2 size={15} />}
            >
              {t(planning ? "Working…" : "Run optimizer")}
            </Button>
            <ButtonLink
              to="/coordinator/schedule"
              variant="secondary"
              className={styles.exportButton}
            >
              Schedule
            </ButtonLink>
          </div>
        </div>
      </header>

      <div className={styles.scopeBar}>
        <div className={styles.scopeOptions} role="group" aria-label="Planning scope">
          <button
            type="button"
            className={styles.scopeButton}
            data-active={scope === "week" ? "true" : "false"}
            aria-pressed={scope === "week"}
            onClick={() => {
              setScope("week");
              invalidatePlan();
            }}
          >
            Next 7 days
            <span>{weekRows.length} shifts with gaps</span>
          </button>
          <button
            type="button"
            className={styles.scopeButton}
            data-active={scope === "shift" ? "true" : "false"}
            aria-pressed={scope === "shift"}
            onClick={() => {
              setScope("shift");
              invalidatePlan();
            }}
          >
            One shift
            <span>Review a single roster</span>
          </button>
        </div>
        <div className={styles.scopeMeta}>
          {scope === "week" ? (
            <>
              <CalendarClock size={13} aria-hidden="true" />
              {scopeStart ? formatDate(scopeStart) : "No dates"} –{" "}
              {scopeEnd ? formatDate(scopeEnd) : "No dates"}
              <span className={styles.sep} aria-hidden="true">
                ·
              </span>
              {requiredSlots - filledSlots} open role{requiredSlots - filledSlots === 1 ? "" : "s"}
            </>
          ) : (
            <label className={styles.shiftPicker}>
              <span className={styles.srOnly}>Shift to optimize</span>
              <select
                value={selectedShiftId}
                onChange={(event) => {
                  setShiftId(event.target.value);
                  invalidatePlan();
                }}
              >
                {upcoming.map((row) => (
                  <option key={row.shift.id} value={row.shift.id}>
                    {row.opportunity.title} · {format(parseISO(row.shift.startsAt), "MMM d")}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
          )}
        </div>
      </div>

      {scope === "shift" && activeRows[0] ? (
        <div className={styles.shiftBar}>
          <div className={styles.shiftBarCopy}>
            <span className={styles.shiftBarLabel}>This shift</span>
            <h2 className={styles.shiftBarTitle}>{activeRows[0].opportunity.title}</h2>
            <p className={styles.shiftBarMeta}>
              <CalendarClock size={13} aria-hidden="true" />
              {formatDate(activeRows[0].shift.startsAt)} ·{" "}
              {timeRange(activeRows[0].shift.startsAt, activeRows[0].shift.endsAt)}
              <span className={styles.sep} aria-hidden="true">
                ·
              </span>
              <MapPin size={13} aria-hidden="true" />
              {activeRows[0].opportunity.address}
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.grid}>
        <CandidatePane {...model} />
        <PlanPane {...model} />
        <RequirementsPane {...model} />
      </div>
    </div>
  );
}
