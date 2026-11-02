import type { CandidateAnswer, RosterPlan } from "../../types/domain";
import type { Candidate } from "./autoRosterModel";
import styles from "./AutoRosterPage.module.css";

export function PlanEvidence({
  explanation,
  alternatives,
  asking,
  answer,
  onAsk,
}: {
  explanation: RosterPlan["assignments"][number]["explanation"];
  alternatives: Candidate[];
  asking: string;
  answer: { slotId: string; candidateName: string; answer: CandidateAnswer } | null;
  onAsk: (candidateId: string, candidateName: string) => void;
}) {
  const showing = answer?.slotId === explanation.slotId ? answer : null;
  const first = explanation.candidateName.split(" ")[0];
  return (
    <>
      <details className={styles.planWhy}>
        <summary>Why {first}?</summary>
        <p className={styles.whyNote}>{explanation.selectionReason}</p>
        <ul className={`${styles.reasonList} ${styles.checkList}`}>
          {explanation.checks.map((check) => (
            <li key={check.name} className={styles.checkRow}>
              <span>
                {check.name} · {check.detail}
              </span>
              <span className={check.passed ? styles.checkPass : styles.checkFail}>
                {check.passed ? "PASS" : "FAIL"}
              </span>
            </li>
          ))}
        </ul>
        <div className={styles.breakdown}>
          {explanation.components.map((row) => (
            <div key={row.label} className={styles.breakdownRow}>
              <span>{row.label}</span>
              <div className={styles.breakdownTrack} aria-hidden="true">
                <span
                  style={{ width: `${row.maximum === 0 ? 0 : (row.awarded / row.maximum) * 100}%` }}
                />
              </div>
              <span className={styles.breakdownValue}>{row.awarded}</span>
            </div>
          ))}
        </div>
      </details>

      {alternatives.length > 0 ? (
        <div className={styles.whyNot}>
          <span className={styles.whyNotLabel}>Ask why not:</span>
          {alternatives.map((candidate) => (
            <button
              key={candidate.volunteer.id}
              type="button"
              className={styles.whyNotButton}
              onClick={() => onAsk(candidate.volunteer.id, candidate.volunteer.name)}
              disabled={asking === candidate.volunteer.id}
            >
              {asking === candidate.volunteer.id
                ? "Checking…"
                : candidate.volunteer.name.split(" ")[0]}
            </button>
          ))}
        </div>
      ) : null}

      {showing ? (
        <div className={styles.answerCard} role="status">
          <p className={styles.answerTitle}>Why not {showing.candidateName}?</p>
          {showing.answer.explanation.eligible ? (
            <p className={styles.whyNote}>
              They clear every requirement for this seat. This is what the plan would do instead:
            </p>
          ) : (
            <ul className={styles.reasonList}>
              {showing.answer.explanation.checks
                .filter((check) => !check.passed)
                .map((check) => (
                  <li key={check.name}>
                    {check.name} · {check.detail}
                  </li>
                ))}
            </ul>
          )}
          {showing.answer.comparison ? (
            <ul className={styles.reasonList}>
              {showing.answer.comparison.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
