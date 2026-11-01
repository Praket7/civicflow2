import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Avatar, Badge, Button, Card, SectionHeader } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useReplacementRecommendations } from "../../lib/workspace/queries";
import { useWorkspace } from "../../lib/workspace/session";
import type { Shift } from "../../types/domain";
import styles from "./OpenSeatsCard.module.css";
import { messageOf } from "../../lib/errors";

/**
 * First waitlisted volunteer who meets every requirement; the people passed
 * over are named.
 */
export function OpenSeatsCard({ shift }: { shift: Shift }) {
  const { actions, session } = useWorkspace();
  const openRoles = shift.roles.filter((role) => role.filled < role.required);
  const { data: recommendations = [] } = useReplacementRecommendations(
    shift.id,
    openRoles.map((role) => role.name),
  );
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // One seat per shift, so someone already on this roster is not a candidate.
  function peopleOnShift(): Set<string> {
    const onShift = new Set<string>();
    session.registrations.forEach((registration) => {
      if (registration.shiftId === shift.id && registration.status === "registered") {
        onShift.add(registration.volunteerId);
      }
    });
    session.waitlist.forEach((entry) => {
      if (entry.shiftId === shift.id && entry.status === "promoted") {
        onShift.add(entry.volunteerId);
      }
    });
    return onShift;
  }

  const onShift = peopleOnShift();
  const rows = recommendations.filter(
    (row) => !(row.recommended && onShift.has(row.recommended.volunteerId)),
  );

  async function promote(volunteerId: string, name: string) {
    setBusy(volunteerId);
    setError("");
    setNotice("");
    try {
      await actions.promoteWaitlist(shift.id, volunteerId);
      setNotice(t("{name} is on the roster. The seat is filled.", { name }));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  if (openRoles.length === 0) return null;

  return (
    <Card padding="compact" ariaLabel={t("Open seats")}>
      <SectionHeader
        title={t("Open seats")}
        subtitle={t("The first eligible volunteer in line, and who was passed over.")}
        action={
          <Badge tone="amber" dot>
            {t(openRoles.length === 1 ? "{count} seat open" : "{count} seats open", {
              count: openRoles.length,
            })}
          </Badge>
        }
      />
      {rows.length === 0 ? (
        <p className={styles.empty}>
          {t("Everyone this seat could go to is already on the roster for this shift.")}
        </p>
      ) : null}
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={`${row.shiftId}-${row.role}`} className={styles.row}>
            <div className={styles.head}>
              <span className={styles.role}>{row.role}</span>
              <span className={styles.summary}>{row.summary}</span>
            </div>
            {row.recommended ? (
              <div className={styles.person}>
                <Avatar initials={row.recommended.initials} tone="cobalt" size={30} />
                <span className={styles.personText}>
                  <span className={styles.name}>{row.recommended.name}</span>
                  <span className={styles.reason}>{row.recommended.reason}</span>
                </span>
                <Button
                  size="small"
                  variant="primary"
                  icon={<UserPlus size={12} aria-hidden="true" />}
                  disabled={busy !== ""}
                  onClick={() => {
                    const person = row.recommended;
                    if (person) void promote(person.volunteerId, person.name);
                  }}
                >
                  {busy === row.recommended.volunteerId ? t("Promoting…") : t("Promote")}
                </Button>
              </div>
            ) : (
              <p className={styles.empty}>
                {t(
                  "Nobody waiting can take this role. Open the coverage center to widen the search.",
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
