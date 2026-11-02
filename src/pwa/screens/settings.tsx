import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Download, TriangleAlert } from "lucide-react";
import { useCloud } from "../../lib/sync/provider";
import {
  disablePush,
  enablePush,
  loadPreferences,
  loadPushConfig,
  pushState,
  savePreferences,
  type NotificationPreferences,
  type PushConfig,
  type PushState,
} from "../../lib/sync/notifications";
import { messageOf } from "../../lib/errors";
import { Button, Card, PageTitle, SyncBar, relativeTime, useInstallPrompt } from "../ui";
import styles from "../pwa.module.css";

export function SettingsScreen() {
  const {
    workspace,
    workspaces,
    selectWorkspace,
    signOut,
    status,
    syncNow,
    conflicts,
    dismissConflict,
    retryConflict,
    view,
  } = useCloud();
  return (
    <div className={styles.stack}>
      <PageTitle eyebrow="Settings" title="This device and your account." />

      <Card>
        <h2 className={styles.cardTitle}>Account</h2>
        <p className={styles.accountEmail}>{view?.email}</p>
        <p className={`${styles.muted} ${styles.accountOrg}`}>{workspace?.organization.name}</p>
        <div className={styles.rowActions}>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Card>

      {workspaces.length > 1 ? (
        <Card>
          <h2 className={styles.cardTitle}>Organization</h2>
          <div className={styles.workspaceList}>
            {workspaces
              .filter((entry) => entry.status === "active")
              .map((entry) => (
                <button
                  key={entry.organizationId}
                  type="button"
                  className={[
                    styles.workspaceRow,
                    entry.organizationId === workspace?.organizationId
                      ? styles.workspaceActive
                      : "",
                  ].join(" ")}
                  onClick={() => void selectWorkspace(entry.organizationId)}
                >
                  <span>{entry.organization.name}</span>
                  <span className={styles.muted}>{entry.role}</span>
                </button>
              ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className={styles.cardTitle}>Sync</h2>
        <SyncBar status={status} onRetry={() => void syncNow()} />
        <dl className={styles.facts}>
          <div>
            <dt>Queued changes</dt>
            <dd>{status.pending}</dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{status.lastSyncedAt ? relativeTime(status.lastSyncedAt) : "Not yet"}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>{status.lastError ?? "None"}</dd>
          </div>
        </dl>
      </Card>

      {conflicts.length > 0 ? (
        <Card className={styles.conflictCard}>
          <h2 className={styles.cardTitle}>
            <TriangleAlert aria-hidden size={18} /> Needs your decision
          </h2>
          <p className={styles.body}>
            These changes were saved on this device but refused by the shared workspace. Nothing was
            overwritten.
          </p>
          <ul className={styles.conflictList}>
            {conflicts.map((conflict) => (
              <li key={conflict.id}>
                <p className={styles.noticeTitle}>{conflict.message}</p>
                <p className={styles.muted}>
                  {conflict.command.replaceAll("_", " ").toLowerCase()} · {conflict.code}
                </p>
                <div className={styles.rowActions}>
                  <Button variant="secondary" onClick={() => void dismissConflict(conflict.id)}>
                    Dismiss
                  </Button>
                  <Button variant="ghost" onClick={() => void retryConflict(conflict)}>
                    Try again
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <NotificationSettings />

      <Card>
        <h2 className={styles.cardTitle}>Help</h2>
        <p className={styles.body}>
          Every screen has a short guide, and the rules for check-in, waitlists, and hours are
          written down where you can read them before you need them.
        </p>
        <div className={styles.rowActions}>
          <Link className={styles.helpLink} to="/help">
            Open help <ArrowRight aria-hidden size={14} />
          </Link>
        </div>
      </Card>

      <p className={styles.finePrint}>
        CivicFlow Volunteer · synced workspace · data stays scoped to your account.
      </p>
    </div>
  );
}

function NotificationSettings() {
  const { workspace } = useCloud();
  const organizationId = workspace?.organizationId ?? null;
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>("unsupported");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    void Promise.all([loadPreferences(organizationId), loadPushConfig(), pushState()])
      .then(([loaded, capabilities, state]) => {
        if (!active) return;
        setPreferences(loaded);
        setConfig(capabilities);
        setPush(state);
        setLoadedFor(organizationId);
        setProblem(null);
      })
      .catch((caught: unknown) => {
        if (active) setProblem(messageOf(caught));
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  if (!workspace || !organizationId) return null;
  if (!preferences || !config || loadedFor !== organizationId) {
    return (
      <Card>
        <h2 className={styles.cardTitle}>Reminders</h2>
        <p className={styles.muted}>Loading how this organization reaches you…</p>
      </Card>
    );
  }

  const update = <Key extends keyof NotificationPreferences>(
    key: Key,
    value: NotificationPreferences[Key],
  ) => setPreferences((current) => (current ? { ...current, [key]: value } : current));

  const pushReady = config.push.configured && push !== "unsupported" && push !== "blocked";
  const pushNote =
    push === "unsupported"
      ? "Install CivicFlow on your phone and open it from the Home Screen to receive push."
      : push === "blocked"
        ? "Notifications are blocked in this browser. Allow them in site settings, then reload."
        : push === "subscribed"
          ? "This device is registered. Turning push off removes it."
          : config.push.configured
            ? "Allow notifications when you save."
            : "Your organization has not enabled push yet.";

  async function save() {
    if (!organizationId || !preferences) return;
    if (Boolean(preferences.quietHoursStart) !== Boolean(preferences.quietHoursEnd)) {
      setProblem("Set both a quiet-hours start and end, or leave both blank.");
      return;
    }

    setBusy(true);
    setMessage(null);
    setProblem(null);
    try {
      if (preferences.push && push !== "subscribed") {
        await enablePush(organizationId, config?.push.publicKey ?? "");
      }
      if (!preferences.push && push === "subscribed") {
        await disablePush();
      }
      await savePreferences(organizationId, preferences);
      setPush(await pushState());
      setMessage("Notification settings saved. New reminders will use them.");
    } catch (caught) {
      setProblem(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className={styles.cardTitle}>Reminders</h2>
      <p className={styles.body}>
        Your organization decides what is worth a reminder. You decide how it reaches you.
      </p>

      <div className={styles.prefList}>
        <label className={styles.prefRow}>
          <input
            type="checkbox"
            aria-label="In the app"
            checked={preferences.inApp}
            onChange={(event) => update("inApp", event.target.checked)}
          />
          <span className={styles.prefCopy}>
            <span className={styles.prefTitle}>In the app</span>
            <span className={styles.fieldHint}>Always kept with your offline schedule.</span>
          </span>
        </label>

        <label className={styles.prefRow}>
          <input
            type="checkbox"
            aria-label="Push to this device"
            checked={preferences.push}
            disabled={!pushReady}
            onChange={(event) => update("push", event.target.checked)}
          />
          <span className={styles.prefCopy}>
            <span className={styles.prefTitle}>Push to this device</span>
            <span className={styles.fieldHint}>{pushNote}</span>
          </span>
        </label>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Remind me before a shift</span>
          <select
            className={styles.input}
            value={preferences.reminderMinutes}
            onChange={(event) => update("reminderMinutes", Number(event.target.value))}
          >
            <option value={60}>1 hour before</option>
            <option value={180}>3 hours before</option>
            <option value={1440}>1 day before</option>
            <option value={2880}>2 days before</option>
            <option value={10080}>1 week before</option>
          </select>
          <span className={styles.fieldHint}>
            Used for shift reminders. Your organization's rule is the fallback.
          </span>
        </label>

        <fieldset className={styles.fieldset}>
          <legend className={styles.fieldLabel}>Quiet hours</legend>
          <div className={styles.prefTime}>
            <label>
              From
              <input
                className={styles.input}
                type="time"
                value={preferences.quietHoursStart ?? ""}
                onChange={(event) => update("quietHoursStart", event.target.value || null)}
              />
            </label>
            <label>
              Until
              <input
                className={styles.input}
                type="time"
                value={preferences.quietHoursEnd ?? ""}
                onChange={(event) => update("quietHoursEnd", event.target.value || null)}
              />
            </label>
          </div>
          <span className={styles.fieldHint}>
            Push waits until quiet hours end. In-app reminders still arrive.
          </span>
        </fieldset>
      </div>

      {message ? <p className={styles.success}>{message}</p> : null}
      {problem ? <p className={styles.error}>{problem}</p> : null}

      <div className={styles.rowActions}>
        <Button loading={busy} onClick={() => void save()}>
          Save notification settings
        </Button>
        <InstallRow />
      </div>
    </Card>
  );
}

function InstallRow() {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <Button variant="ghost" onClick={() => void install()}>
      <Download aria-hidden size={16} /> Install this app
    </Button>
  );
}
