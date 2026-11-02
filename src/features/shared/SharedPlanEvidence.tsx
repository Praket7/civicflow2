import type { CandidateAnswer, CandidateEvaluation, MatchExplanation } from "../../types/domain";
import styles from "./shared.module.css";

export interface SharedAnswer {
  slotId: string;
  candidateName: string;
  answer: CandidateAnswer;
}

export function SharedPlanEvidence({
  explanation,
  alternatives,
  asking,
  answer,
  error,
  onAsk,
}: {
  explanation: MatchExplanation;
  alternatives: CandidateEvaluation[];
  asking: string;
  answer: SharedAnswer | null;
  error: string;
  onAsk: (candidateId: string, candidateName: string) => void;
}) {
  const showing = answer?.slotId === explanation.slotId ? answer : null;
  const first = explanation.candidateName.split(" ")[0] || "this person";

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
        {explanation.components.length > 0 ? (
          <div className={styles.breakdown}>
            {explanation.components.map((row) => (
              <div key={row.label} className={styles.breakdownRow}>
                <span>{row.label}</span>
                <div className={styles.breakdownTrack} aria-hidden="true">
                  <span
                    style={{
                      width: `${row.maximum === 0 ? 0 : (row.awarded / row.maximum) * 100}%`,
                    }}
                  />
                </div>
                <span className={styles.breakdownValue}>{row.awarded}</span>
              </div>
            ))}
          </div>
        ) : null}
      </details>

      {alternatives.length > 0 ? (
        <div className={styles.whyNot}>
          <span className={styles.whyNotLabel}>Ask why not:</span>
          {alternatives.map((candidate) => (
            <button
              key={candidate.candidateId}
              type="button"
              className={styles.whyNotButton}
              onClick={() => onAsk(candidate.candidateId, candidate.candidateName)}
              disabled={asking === candidate.candidateId}
            >
              {asking === candidate.candidateId
                ? "Checking…"
                : candidate.candidateName.split(" ")[0] || "Volunteer"}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className={styles.evidenceError} role="alert">
          {error}
        </p>
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
