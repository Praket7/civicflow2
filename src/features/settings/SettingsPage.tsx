import { useState } from "react";
import {
  Accessibility,
  Bell,
  Database,
  Gauge,
  LifeBuoy,
  RefreshCw,
  RotateCcw,
  Settings2,
  UserRound,
} from "lucide-react";
import { replayTour } from "../../components/help/FirstRunTour";
import { Badge, Button, ButtonLink, Card, Page, PageHeader, Toggle } from "../../components/ui";
import { useAuth } from "../../lib/auth/session";
import { t } from "../../lib/i18n";
import { getHourRows } from "../../lib/workspace/selectors";
import { useWorkspace } from "../../lib/workspace/session";
import styles from "../records/Records.module.css";
import { AccountsSettingsCard } from "./AccountsSettingsCard";
import { GeneralSettingsCard } from "./GeneralSettingsCard";
import { ReminderRulesCard } from "./ReminderRulesCard";
import { SchedulingSettingsCard } from "./SchedulingSettingsCard";
import { UpdateCard } from "./UpdateCard";
import { VolunteerImportCard } from "./VolunteerImportCard";

const CATEGORIES = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "accounts", label: "Accounts", icon: UserRound },
  { id: "scheduling", label: "Scheduling", icon: Gauge },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "accessibility", label: "Accessibility", icon: Accessibility },
  { id: "data", label: "Local data", icon: Database },
  { id: "updates", label: "Updates", icon: RefreshCw },
];

export function SettingsPage() {
  const { workspace, session, backups, actions } = useWorkspace();
  const { user } = useAuth();
  const [category, setCategory] = useState("general");
  const [saved, setSaved] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const categories = CATEGORIES.filter(
    (item) => item.id !== "accounts" || user?.role === "coordinator",
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Defaults for this local workspace. Changes are saved on this device and recorded in the audit log."
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <ButtonLink to="/help" variant="secondary" icon={<LifeBuoy size={13} />}>
              Help and guides
            </ButtonLink>
            <Button
              variant="ghost"
              icon={<RotateCcw size={13} />}
              onClick={() => replayTour(user?.role === "coordinator" ? "coordinator" : "volunteer")}
            >
              Replay tour
            </Button>
            <Badge tone="green" dot>
              Local workspace
            </Badge>
          </div>
        }
      />

      <div className={styles.settingsLayout}>
        <nav className={styles.categoryNav} aria-label="Settings categories">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.categoryButton} ${category === item.id ? styles.categoryButtonActive : ""}`}
              aria-current={category === item.id ? "page" : undefined}
              onClick={() => {
                setCategory(item.id);
                setSaved("");
              }}
            >
              <item.icon size={14} aria-hidden="true" />
              {t(item.label)}
            </button>
          ))}
        </nav>

        <Card className={styles.settingsCard}>
          {category === "general" ? <GeneralSettingsCard /> : null}
          {category === "accounts" ? <AccountsSettingsCard /> : null}
          {category === "scheduling" ? <SchedulingSettingsCard /> : null}
          {category === "notifications" ? (
            <>
              <h2 className={styles.settingsTitle}>Notifications</h2>
              <p className={styles.settingsSub}>
                Choose what lands in the inbox. Critical coverage alerts are always delivered
                in-app.
              </p>
              <div style={{ marginTop: 12 }}>
                <Toggle
                  label="Weekly email digest"
                  hint="A summary of hours, coverage gaps, and volunteer follow-ups."
                  checked={session.settings.emailDigest === "weekly"}
                  onChange={(checked) =>
                    actions.updateSettings({ emailDigest: checked ? "weekly" : "off" })
                  }
                />
                <Toggle
                  label="Daily coverage reminders"
                  hint="One reminder each morning when an upcoming shift still has a role gap."
                  checked={session.settings.emailDigest !== "off"}
                  onChange={(checked) =>
                    actions.updateSettings({ emailDigest: checked ? "daily" : "off" })
                  }
                />
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <ButtonLink to="/coordinator/notifications" variant="secondary">
                  Open inbox
                </ButtonLink>
                <ButtonLink to="/coordinator/backup" variant="ghost">
                  Backup reminders
                </ButtonLink>
              </div>
            </>
          ) : null}

          {category === "accessibility" ? (
            <>
              <h2 className={styles.settingsTitle}>Comfort and access</h2>
              <p className={styles.settingsSub}>
                These preferences apply immediately across the workspace and are stored on this
                device.
              </p>
              <div style={{ marginTop: 12 }}>
                <Toggle
                  label="Higher contrast"
                  hint="Deepens supporting text and borders for easier reading."
                  checked={session.settings.highContrast}
                  onChange={(checked) => actions.updateSettings({ highContrast: checked })}
                />
                <Toggle
                  label="Reduce motion"
                  hint="Turns off decorative motion while keeping interface state changes."
                  checked={session.settings.reducedMotion}
                  onChange={(checked) => actions.updateSettings({ reducedMotion: checked })}
                />
                <Toggle
                  label="Underline all links"
                  hint="Makes link targets identifiable without relying on color."
                  checked={session.settings.underlineLinks}
                  onChange={(checked) => actions.updateSettings({ underlineLinks: checked })}
                />
              </div>
              <div className={styles.saveRow}>
                <ButtonLink to="/coordinator/accessibility" variant="primary">
                  Open accessibility studio
                </ButtonLink>
              </div>
            </>
          ) : null}

          {category === "updates" ? (
            <>
              <h2 className={styles.settingsTitle}>Application updates</h2>
              <p className={styles.settingsSub}>
                Check the signed release feed. Nothing is downloaded until you choose to install it.
              </p>
              <div style={{ marginTop: 12 }}>
                <UpdateCard />
              </div>
            </>
          ) : null}

          {category === "data" ? (
            <>
              <h2 className={styles.settingsTitle}>Local data</h2>
              <p className={styles.settingsSub}>
                Everything is stored in a local SQLite database. No account or cloud connection is
                required for the demo.
              </p>
              <div className={styles.formGrid}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 590 }}>Database</div>
                  <p style={{ marginTop: 3, fontSize: 12.5, color: "var(--text-muted)" }}>
                    {workspace.volunteers.length} volunteers · {workspace.shifts.length} shifts ·{" "}
                    {getHourRows(session, workspace).length} hour records
                  </p>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 590 }}>Snapshots</div>
                  <p style={{ marginTop: 3, fontSize: 12.5, color: "var(--text-muted)" }}>
                    {backups.length} available · last{" "}
                    {backups[0]?.createdAt.slice(5, 16).replace("T", " ") ?? "none yet"}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <ButtonLink to="/coordinator/backup" variant="secondary">
                  Backup & recovery
                </ButtonLink>
                <ButtonLink to="/coordinator/records" variant="secondary">
                  Browse records
                </ButtonLink>
              </div>
              {user?.role === "coordinator" ? <VolunteerImportCard /> : null}
              {user?.role === "coordinator" ? <ReminderRulesCard /> : null}
              <div
                style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 590 }}>Reset demo workspace</div>
                <p
                  style={{
                    marginTop: 3,
                    fontSize: 12.5,
                    color: "var(--text-muted)",
                    lineHeight: 1.5,
                  }}
                >
                  Restores saved opportunities, hours decisions, check-ins, and display preferences
                  to their original demo values. This cannot be undone.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                  <Button
                    variant={resetArmed ? "danger" : "secondary"}
                    icon={<RotateCcw size={13} />}
                    onClick={() => {
                      if (resetArmed) {
                        actions.resetDemo();
                        setResetArmed(false);
                        setSaved(
                          "Demo workspace reset. Every surface now reads the restored seed.",
                        );
                      } else {
                        setResetArmed(true);
                      }
                    }}
                  >
                    {resetArmed ? "Confirm reset" : "Reset demo data"}
                  </Button>
                  {resetArmed ? (
                    <Button variant="ghost" onClick={() => setResetArmed(false)}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
                {saved ? (
                  <p
                    style={{ marginTop: 8, fontSize: 12.5, color: "var(--tone-green-ink)" }}
                    role="status"
                  >
                    {saved}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
