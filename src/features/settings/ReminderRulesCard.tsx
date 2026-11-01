import { useState } from "react";
import { BellRing, Send } from "lucide-react";
import { Badge, Button, Card, SectionHeader, Toggle } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useNotificationRules, useUpdateNotificationRule } from "../../lib/workspace/queries";
import { useWorkspace } from "../../lib/workspace/session";
import type { NotificationRule, ReminderTrigger } from "../../types/domain";
import styles from "./ReminderRules.module.css";
import { messageOf } from "../../lib/errors";

const TRIGGER_LABEL: Record<ReminderTrigger, string> = {
  shift_reminder: "Shift reminder",
  checkin_soon: "Check-in opens soon",
  missed_shift_follow_up: "Follow up a missed shift",
  credential_expiring: "Credential expiring",
};

const AUDIENCE_LABEL: Record<NotificationRule["audience"], string> = {
  volunteer: "Volunteer",
  coordinator: "Coordinator",
};

/** 1440 minutes is a day, so the sentence reads in the unit a person thinks in. */
function offsetLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return t(days === 1 ? "{count} day before" : "{count} days before", { count: days });
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return t(hours === 1 ? "{count} hour before" : "{count} hours before", { count: hours });
  }
  return t("{count} minutes before", { count: minutes });
}

/**
 * Each rule has a trigger, audience and switch; every notification records the
 * rule that produced it.
 */
export function ReminderRulesCard() {
  const { actions } = useWorkspace();
  const { data: rules = [], error: readError } = useNotificationRules();
  const update = useUpdateNotificationRule();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  async function toggle(rule: NotificationRule, enabled: boolean) {
    setBusy(rule.id);
    setError("");
    setNotice("");
    try {
      await update.mutateAsync({ ruleId: rule.id, patch: { enabled } });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  async function queue() {
    setBusy("queue");
    setError("");
    setNotice("");
    try {
      const written = await actions.queueDueReminders();
      setNotice(
        t(
          written === 1
            ? "Queued {count} reminder that was due."
            : "Queued {count} reminders that were due.",
          { count: written },
        ),
      );
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  return (
    <Card className={styles.card} ariaLabel={t("Reminder rules")}>
      <SectionHeader
        title="Reminder rules"
        subtitle={t(
          "Deterministic reminders, generated from the schedule and the credential register.",
        )}
        action={
          <Badge tone="neutral" dot>
            {t(
              rules.filter((rule) => rule.enabled).length === 1
                ? "{count} active rule"
                : "{count} active rules",
              {
                count: rules.filter((rule) => rule.enabled).length,
              },
            )}
          </Badge>
        }
      />
      <ul className={styles.list}>
        {rules.map((rule) => (
          <li key={rule.id} className={styles.row}>
            <Toggle
              label={TRIGGER_LABEL[rule.triggerType]}
              hint={`${AUDIENCE_LABEL[rule.audience]} · ${offsetLabel(rule.offsetMinutes)}`}
              checked={rule.enabled}
              onChange={(checked) => void toggle(rule, checked)}
            />
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        <Button
          variant="secondary"
          size="small"
          icon={<Send size={13} />}
          disabled={busy !== ""}
          onClick={() => void queue()}
        >
          {busy === "queue" ? t("Queuing…") : t("Queue due reminders")}
        </Button>
        <span className={styles.hint}>
          <BellRing size={12} aria-hidden="true" />
          {t("A reminder is written once; running it again finds the first one.")}
        </span>
      </div>
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
