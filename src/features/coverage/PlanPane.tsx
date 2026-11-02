import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Wand2 } from "lucide-react";
import { Avatar, Button, Toggle } from "../../components/ui";
import { t } from "../../lib/i18n";
import { formatDate, timeRange } from "../../lib/workspace/selectors";
import styles from "./AutoRosterPage.module.css";
import { PlanEvidence } from "./PlanEvidence";
import type { AutoRosterModel } from "./useAutoRoster";

export function PlanPane({
  scope,
  planning,
  applied,
  appliedCount,
  plan,
  plannedCandidates,
  afterRolePercent,
  beforeRolePercent,
  beforeSeatPercent,
  afterSeatPercent,
  coverageGain,
  excludedCount,
  error,
  stale,
  answerError,
  generatePlan,
  answer,
  asking,
  alternativesFor,
  askWhyNot,
  applyPlan,
  applying,
  distinctPeople,
  unfilledCount,
  conflictCount,
  credentialCount,
  planGroups,
  options,
  updateOption,
  weightRows,
  weights,
}: AutoRosterModel) {
  return (
    <section className={`${styles.pane} ${styles.plan}`} aria-label="Proposed roster">
      <div className={styles.paneHead}>
        <div>
          <h2 className={styles.paneTitle}>{scope === "week" ? "The weekly plan" : "The plan"}</h2>
          <p className={styles.paneSub}>
            {planning
              ? "Reading availability, clashes, and recent attendance."
              : applied
                ? `Applied ${appliedCount} assignment${appliedCount === 1 ? "" : "s"} to the live roster.`
                : plan
                  ? plannedCandidates.length > 0
                    ? t(
                        plannedCandidates.length === 1
                          ? "{count} person would close a gap in this plan."
                          : "{count} people would close the gaps in this plan.",
                        { count: plannedCandidates.length },
                      )
                    : t("Nobody clears the current rules for this shift.")
                  : t("Run the optimizer to see who fits each open role, and why.")}
          </p>
        </div>
        <div
          className={styles.planCoverage}
          aria-label={t("Projected role coverage {percent} percent", {
            percent: afterRolePercent,
          })}
        >
          <span>{afterRolePercent}%</span>
          <small>covered</small>
        </div>
      </div>

      <div className={styles.coveragePanel}>
        <div className={styles.coverageFigures}>
          <div>
            <span className={styles.coverageLabel}>Role coverage</span>
            <p className={styles.coverageNumbers}>
              <span>{beforeRolePercent}%</span>
              <ArrowRight size={14} aria-hidden="true" />
              <strong>{afterRolePercent}%</strong>
            </p>
          </div>
          <div>
            <span className={styles.coverageLabel}>Seats filled</span>
            <p className={styles.coverageNumbers}>
              <span>{beforeSeatPercent}%</span>
              <ArrowRight size={14} aria-hidden="true" />
              <strong>{afterSeatPercent}%</strong>
            </p>
          </div>
        </div>
        <div
          className={styles.coverageTrackWide}
          role="img"
          aria-label={`Role coverage moves from ${beforeRolePercent} to ${afterRolePercent} percent`}
        >
          <span className={styles.coverageBefore} style={{ width: `${beforeRolePercent}%` }} />
          <span className={styles.coverageAfter} style={{ width: `${afterRolePercent}%` }} />
        </div>
        <p className={styles.coverageHint}>
          {applied
            ? t("The live roster now reflects this plan.")
            : coverageGain > 0
              ? t("This plan adds {points} points of role coverage.", { points: coverageGain })
              : t("No change in role coverage yet.")}
          {excludedCount > 0
            ? ` ${t(
                excludedCount === 1
                  ? "{count} person is held back by the active rules."
                  : "{count} people are held back by the active rules.",
                { count: excludedCount },
              )}`
            : ""}
        </p>
      </div>

      {error ? (
        <p className={styles.errorNote} role="alert">
          {error}
        </p>
      ) : null}

      {stale ? (
        <div className={styles.stalePanel}>
          <Button
            variant="secondary"
            size="small"
            onClick={() => void generatePlan()}
            disabled={planning}
          >
            Rebuild plan
          </Button>
        </div>
      ) : null}

      {answerError ? (
        <p className={styles.errorNote} role="alert">
          {answerError}
        </p>
      ) : null}

      {applied ? (
        <div className={styles.appliedPanel} role="status">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <p className={styles.appliedTitle}>
              {appliedCount} assignment{appliedCount === 1 ? "" : "s"} applied
            </p>
            <p className={styles.appliedBody}>
              Written to the live roster and the audit log in one transaction.
            </p>
            <Link className={styles.textLink} to="/coordinator/schedule">
              Review the schedule
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : plannedCandidates.length > 0 ? (
        <>
          <p className={styles.planSummary}>
            {plannedCandidates.length} assignment{plannedCandidates.length === 1 ? "" : "s"} across{" "}
            {distinctPeople} volunteer{distinctPeople === 1 ? "" : "s"}
            {unfilledCount > 0
              ? ` · ${unfilledCount} role${unfilledCount === 1 ? "" : "s"} still open`
              : " · every required role filled"}
          </p>
          <ul className={styles.outcomeStrip} aria-label="Plan checks">
            <li data-tone={conflictCount === 0 ? "good" : "bad"}>
              {conflictCount === 0
                ? "No schedule conflicts"
                : `${conflictCount} scheduling conflict${conflictCount === 1 ? "" : "s"}`}
            </li>
            <li data-tone={credentialCount === 0 ? "good" : "bad"}>
              {credentialCount === 0
                ? "Credentials checked"
                : `${credentialCount} credential issue${credentialCount === 1 ? "" : "s"}`}
            </li>
            <li data-tone="good">Load spread across {distinctPeople}</li>
          </ul>
          {planGroups.map((group) => (
            <div key={group.row.shift.id} className={styles.planGroup}>
              <div className={styles.planGroupHead}>
                <h3 className={styles.planGroupTitle}>{group.row.opportunity.title}</h3>
                <p className={styles.planGroupMeta}>
                  {formatDate(group.row.shift.startsAt)} ·{" "}
                  {timeRange(group.row.shift.startsAt, group.row.shift.endsAt)}
                </p>
              </div>
              <ul className={styles.planList}>
                {group.rows.map((assignment) => {
                  const candidate = assignment.candidate;
                  return (
                    <li
                      key={`${assignment.shiftId}-${assignment.gap.name}-${candidate.volunteer.id}`}
                      className={styles.planRow}
                    >
                      <Avatar
                        initials={candidate.volunteer.initials}
                        src={candidate.volunteer.photo}
                        tone={candidate.volunteer.tone}
                        size={38}
                        label={candidate.volunteer.name}
                      />
                      <div className={styles.planPerson}>
                        <span className={styles.planName}>{candidate.volunteer.name}</span>
                        <span className={styles.planRole}>
                          {assignment.gap.name}
                          {candidate.volunteer.languages.includes("Spanish") ? " · Spanish" : ""}
                        </span>
                      </div>
                      <span className={styles.planReason}>
                        {candidate.reasons[0] ??
                          `${candidate.volunteer.attendanceRate}% attendance`}
                      </span>
                      <span className={styles.planScore}>{candidate.score}</span>
                      <PlanEvidence
                        explanation={assignment.backend.explanation}
                        alternatives={alternativesFor(assignment.gap.name, candidate.volunteer.id)}
                        asking={asking}
                        answer={answer}
                        onAsk={(candidateId, name) =>
                          void askWhyNot(assignment.backend.explanation.slotId, candidateId, name)
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className={styles.planActions}>
            <Button
              className={styles.applyButton}
              onClick={() => void applyPlan()}
              disabled={applying}
              icon={applying ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />}
            >
              {applying
                ? "Applying…"
                : `Apply ${plannedCandidates.length} assignment${
                    plannedCandidates.length === 1 ? "" : "s"
                  }`}
            </Button>
            <p className={styles.applyNote}>
              Nothing is saved until you apply. The batch is checked again before it writes.
            </p>
          </div>
        </>
      ) : plan ? (
        <div className={styles.emptyPlan}>
          <p className={styles.emptyPlanTitle}>No automatic match.</p>
          <p className={styles.emptyPlanBody}>
            The remaining people either lack the required skill, are already booked at this time, or
            have unconfirmed availability. Allow waitlisted volunteers, then run it again.
          </p>
        </div>
      ) : (
        <div className={styles.emptyPlan}>
          <p className={styles.emptyPlanTitle}>Nothing proposed yet.</p>
          <p className={styles.emptyPlanBody}>
            A run does not book anyone. It only suggests people for the open roles; you review the
            list before anything reaches the roster.
          </p>
          <Button
            variant="secondary"
            onClick={() => void generatePlan()}
            disabled={planning}
            icon={<Wand2 size={15} />}
          >
            {t(planning ? "Working…" : "Build the plan")}
          </Button>
        </div>
      )}

      <details className={styles.engineOptions}>
        <summary>Matching settings</summary>
        <div className={styles.toggles}>
          <Toggle
            label="Prefer Spanish speakers"
            hint="Adds up to 10 points to bilingual candidates."
            checked={options.preferSpanish}
            onChange={(value) => updateOption("preferSpanish", value)}
          />
          <Toggle
            label="Include waitlist"
            hint="Waiting volunteers can be promoted into a gap."
            checked={options.includeWaitlist}
            onChange={(value) => updateOption("includeWaitlist", value)}
          />
          <Toggle
            label="Block overlapping shifts"
            hint="Keeps anyone already booked at this time out of the plan."
            checked={options.blockConflicts}
            onChange={(value) => updateOption("blockConflicts", value)}
          />
          <Toggle
            label="Cap at 2 shifts per week"
            hint="Protects volunteers from over-scheduling."
            checked={options.capWeekly}
            onChange={(value) => updateOption("capWeekly", value)}
          />
        </div>
        {weightRows.length > 0 ? (
          <div className={styles.weights}>
            <p className={styles.miniLabel}>
              How the match score is built · policy v{weights?.version}
            </p>
            {weightRows.map((row) => (
              <div key={row.label} className={styles.weightRow}>
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </details>

      <p className={styles.engineNote}>
        Deterministic and offline. The same inputs always produce the same roster.
      </p>
    </section>
  );
}
