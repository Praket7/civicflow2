import { useMemo, useState } from "react";
import { CalendarClock, LifeBuoy, ShieldAlert, Sparkles } from "lucide-react";
import { Badge, Button, Card, CheckboxField, SectionHeader } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useDisruptions } from "../../lib/workspace/queries";
import { useWorkspace } from "../../lib/workspace/session";
import { formatDate } from "../../lib/workspace/selectors";
import type { RecoveryChange, RecoveryChangeRequest, RecoveryPlan } from "../../types/domain";
import styles from "./CoveragePage.module.css";
import { messageOf } from "../../lib/errors";

const CHANGE_LABEL: Record<RecoveryChange["kind"], string> = {
  assign: "New assignment",
  promote: "Waitlist promotion",
  move: "Move on this shift",
};

function changeKey(change: RecoveryChange): string {
  return `${change.shiftId}:${change.role}:${change.volunteerId}`;
}

function toRequest(change: RecoveryChange): RecoveryChangeRequest {
  return {
    volunteerId: change.volunteerId,
    role: change.role,
    fromRole: change.fromRole,
    promoteWaitlist: change.kind === "promote",
  };
}

/**
 * Shows what is short now; the repair plan comes from the Rust solver and
 * reports what each change costs.
 */
export function RecoveryRescueCard() {
  const { actions } = useWorkspace();
  const { data: report = null } = useDisruptions();
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const shifts = report?.shifts ?? [];
  const selectedChanges = useMemo(
    () => (plan?.changes ?? []).filter((change) => chosen[changeKey(change)] !== false),
    [chosen, plan],
  );

  async function generate(shiftId: string) {
    setBusy(shiftId);
    setError("");
    setNotice("");
    try {
      const next = await actions.planRecovery([shiftId], {
        preferSpanish: true,
        blockConflicts: true,
        capWeekly: false,
        includeWaitlist: true,
      });
      setPlan(next);
      setChosen({});
      if (next.changes.length === 0) {
        setNotice(t("No eligible volunteer can take the open seats on this shift right now."));
      }
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    if (!plan || selectedChanges.length === 0) return;
    setBusy("apply");
    setError("");
    setNotice("");
    try {
      const shiftId = selectedChanges[0].shiftId;
      await actions.applyRecovery(shiftId, selectedChanges.map(toRequest));
      setNotice(
        t(
          selectedChanges.length === 1
            ? "Applied {count} change to the roster."
            : "Applied {count} changes to the roster.",
          { count: selectedChanges.length },
        ),
      );
      setPlan(null);
      setChosen({});
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  if (!report) return null;
  if (shifts.length === 0 && report.atRisk.length === 0) return null;

  return (
    <Card className={styles.rescueCard} ariaLabel={t("Coverage rescue")}>
      <SectionHeader
        title="Coverage rescue"
        subtitle={t(
          "Required seats with nobody in them, and credentials that will not be valid when the shift starts.",
        )}
        action={
          <Badge tone={report.openRequired > 0 ? "amber" : "neutral"} dot>
            {t(
              report.openRequired === 1
                ? "{count} required seat open"
                : "{count} required seats open",
              { count: report.openRequired },
            )}
          </Badge>
        }
      />

      {shifts.length === 0 ? null : (
        <ul className={styles.rescueList}>
          {shifts.map((shift) => (
            <li key={shift.shiftId} className={styles.rescueRow}>
              <div className={styles.rescueCopy}>
                <p className={styles.rescueTitle}>
                  <LifeBuoy size={13} aria-hidden="true" />
                  {shift.title}
                </p>
                <p className={styles.rescueMeta}>
                  <CalendarClock size={12} aria-hidden="true" />
                  {formatDate(shift.startsAt)}
                  {" · "}
                  {t("{filled} of {capacity} seats filled", {
                    filled: shift.confirmed,
                    capacity: shift.capacity,
                  })}
                </p>
                <ul className={styles.rescueRoles}>
                  {shift.roles.map((role) => (
                    <li key={role.role}>
                      <span>{role.role}</span>
                      <span className="tabular">
                        {role.filled} / {role.required}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                variant="secondary"
                size="small"
                icon={<Sparkles size={13} />}
                disabled={busy === shift.shiftId}
                onClick={() => void generate(shift.shiftId)}
              >
                {busy === shift.shiftId ? t("Planning…") : t("Generate recovery plan")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {report.atRisk.length === 0 ? null : (
        <div className={styles.rescueRisk}>
          <p className={styles.rescueRiskTitle}>
            <ShieldAlert size={13} aria-hidden="true" />
            {t("Assignments at risk from an expired credential")}
          </p>
          <ul className={styles.rescueRiskList}>
            {report.atRisk.map((row) => (
              <li key={`${row.shiftId}:${row.volunteerId}`}>
                <strong>{row.volunteerName}</strong> · {row.shiftTitle} · {row.role} ·{" "}
                {row.credential}
                {row.validThrough
                  ? ` (${t("valid through {date}", { date: row.validThrough })})`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan ? (
        <div className={styles.rescuePlan}>
          <SectionHeader
            title="Recommended changes"
            subtitle={t(
              "Coverage first, then the fewest disturbed assignments, then match quality.",
            )}
          />
          {plan.changes.length === 0 ? (
            <p className={styles.rescueEmpty}>
              {t("Nothing in this plan would improve coverage.")}
            </p>
          ) : (
            <ul className={styles.planList}>
              {plan.changes.map((change) => {
                const key = changeKey(change);
                return (
                  <li key={key} className={styles.planRow}>
                    <CheckboxField
                      label={change.volunteerName}
                      hint={
                        change.fromRole
                          ? t("{fromRole} to {role}", {
                              fromRole: change.fromRole,
                              role: change.role,
                            })
                          : change.role
                      }
                      checked={chosen[key] !== false}
                      onChange={(event) =>
                        setChosen((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                    <p className={styles.planReason}>{change.reason}</p>
                    <span className={styles.planCost}>
                      <Badge tone={change.kind === "move" ? "amber" : "neutral"}>
                        {t(CHANGE_LABEL[change.kind])}
                      </Badge>
                      <span className="tabular">{t("cost {cost}", { cost: change.cost })}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <p className={styles.planFoot}>
            {t("Coverage restored: {before} to {after} open seats", {
              before: plan.openBefore,
              after: plan.openAfter,
            })}
            {" · "}
            {t(
              plan.movedAssignments === 1
                ? "{count} existing assignment changed"
                : "{count} existing assignments changed",
              { count: plan.movedAssignments },
            )}
            {" · "}
            {t("policy v{version}", { version: plan.policyVersion })}
          </p>

          {plan.remaining.length === 0 ? null : (
            <ul className={styles.planRemaining}>
              {plan.remaining.map((seat) => (
                <li key={`${seat.shiftId}:${seat.role}`}>
                  <strong>{seat.role}</strong> · {seat.reason}
                </li>
              ))}
            </ul>
          )}

          <div className={styles.rescueActions}>
            <Button
              variant="primary"
              disabled={busy === "apply" || selectedChanges.length === 0}
              onClick={() => void apply()}
            >
              {busy === "apply" ? t("Applying…") : t("Apply selected changes")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPlan(null);
                setChosen({});
              }}
            >
              {t("Dismiss")}
            </Button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className={styles.rescueNotice} role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={styles.rescueError} role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
