import { Sparkles } from "lucide-react";
import { formatDate } from "../../lib/workspace/selectors";
import styles from "./AutoRosterPage.module.css";
import { ROLE_COLORS } from "./autoRosterModel";
import type { AutoRosterModel } from "./useAutoRoster";

export function RequirementsPane({
  scope,
  rosterTotal,
  shiftPlans,
  filledSlots,
  requiredSlots,
  capacityTotal,
  data,
}: AutoRosterModel) {
  return (
    <section className={`${styles.pane} ${styles.requirements}`} aria-label="Shift requirements">
      <div className={styles.paneHead}>
        <div>
          <h2 className={styles.paneTitle}>{scope === "week" ? "Week brief" : "Shift brief"}</h2>
          <p className={styles.paneSub}>What each shift asks for, and what is already covered.</p>
        </div>
        <span className={styles.paneCount}>
          <strong>{rosterTotal}</strong> on roster
        </span>
      </div>

      <div className={styles.briefBlocks}>
        {shiftPlans.map((shiftPlan) => (
          <div key={shiftPlan.row.shift.id} className={styles.briefBlock}>
            <div className={styles.briefHead}>
              <h3 className={styles.subhead}>{shiftPlan.row.opportunity.title}</h3>
              <span className={styles.briefDate}>{formatDate(shiftPlan.row.shift.startsAt)}</span>
            </div>
            <ul className={styles.roleList}>
              {shiftPlan.row.shift.roles.map((role, index) => {
                const filled = shiftPlan.filledByRole.get(role.name) ?? 0;
                return (
                  <li key={role.name} className={styles.roleRow}>
                    <span
                      className={styles.roleDot}
                      style={{ background: ROLE_COLORS[index % ROLE_COLORS.length] }}
                      aria-hidden="true"
                    />
                    <span className={styles.roleName}>{role.name}</span>
                    <span
                      className={styles.roleCount}
                      data-full={filled >= role.required ? "true" : "false"}
                    >
                      {filled}/{role.required}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className={styles.briefTotals}>
        <div>
          <span>Role slots</span>
          <strong>
            {filledSlots} of {requiredSlots}
          </strong>
        </div>
        <div>
          <span>Seats filled</span>
          <strong>
            {rosterTotal} of {capacityTotal}
          </strong>
        </div>
        <div>
          <span>People eligible</span>
          <strong>{data.candidates.length}</strong>
        </div>
      </div>

      <div className={styles.briefNote}>
        <Sparkles size={15} aria-hidden="true" />
        <p>
          Role coverage counts required slots. Seats count people, including volunteers who can
          cover more than one role.
        </p>
      </div>

      <p className={styles.requirementsFoot}>
        {requiredSlots - filledSlots} open role{requiredSlots - filledSlots === 1 ? "" : "s"} ·{" "}
        {rosterTotal} on roster now
      </p>
    </section>
  );
}
