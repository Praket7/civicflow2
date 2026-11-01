import { useEffect, useRef, useState } from "react";
import {
  Accessibility,
  Bell,
  Check,
  Database,
  Gauge,
  ImagePlus,
  KeyRound,
  LifeBuoy,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { replayTour } from "../../components/help/FirstRunTour";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Page,
  PageHeader,
  SelectField,
  TextareaField,
  TextField,
  Toggle,
} from "../../components/ui";
import { useAuth } from "../../lib/auth/session";
import { t } from "../../lib/i18n";
import { coverPhoto } from "../../lib/images";
import { updateOrganizationCover, updateOrganizationDetails } from "../../lib/organizations/store";
import { ORGANIZATION_COVERS } from "../../lib/organizations/types";
import { US_STATES, stateCode } from "../../lib/us-states";
import { getWorkspaceRepository } from "../../lib/workspace/repository";
import { useWorkspace } from "../../lib/workspace/session";
import { getHourRows } from "../../lib/workspace/selectors";
import { ReminderRulesCard } from "./ReminderRulesCard";
import { SharedWorkspaceCard } from "./SharedWorkspaceCard";
import { UpdateCard } from "./UpdateCard";
import { VolunteerImportCard } from "./VolunteerImportCard";
import type { PriorityLevel, RosterPolicy } from "../../types/domain";
import type { Account } from "../../types/domain";
import styles from "../records/Records.module.css";
import { messageOf } from "../../lib/errors";

// A limit a coordinator left blank means "no cap of its own".
function limitOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function levelLabel(level: PriorityLevel): string {
  const name = level.key.charAt(0).toUpperCase() + level.key.slice(1);
  return level.weight === 0 ? `${name} (0)` : `${name} (${level.weight} points)`;
}

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
  const { user, token, signOut } = useAuth();
  const [category, setCategory] = useState("general");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsError, setAccountsError] = useState("");
  const [resetFor, setResetFor] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  // A workspace saved before these settings existed starts from its record.
  const [orgName, setOrgName] = useState(
    session.settings.organizationName || workspace.organization.name,
  );
  const [email, setEmail] = useState(
    session.settings.contactEmail || workspace.organization.email || user?.email || "",
  );
  const [mission, setMission] = useState(workspace.organization.mission);
  const [address, setAddress] = useState(workspace.organization.address);
  const [city, setCity] = useState(workspace.organization.city);
  const [stateValue, setStateValue] = useState(stateCode(workspace.organization.state));
  const [website, setWebsite] = useState(workspace.organization.website);
  const [cover, setCover] = useState({
    src: workspace.organization.image ?? ORGANIZATION_COVERS[0].src,
    alt: workspace.organization.imageAlt ?? ORGANIZATION_COVERS[0].alt,
  });
  const [timezone, setTimezone] = useState(session.settings.timezone);
  const [weekStart, setWeekStart] = useState(session.settings.weekStartsOn);
  const [shiftLength, setShiftLength] = useState(String(session.settings.defaultShiftLength));
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const [policyLevels, setPolicyLevels] = useState<PriorityLevel[]>([]);
  const [policy, setPolicy] = useState<RosterPolicy | null>(null);
  const [policyError, setPolicyError] = useState("");
  const [policySaved, setPolicySaved] = useState("");
  const [policyBusy, setPolicyBusy] = useState(false);
  const categories = CATEGORIES.filter(
    (item) => item.id !== "accounts" || user?.role === "coordinator",
  );

  useEffect(() => {
    if (category !== "accounts" || !token) return;
    let active = true;
    getWorkspaceRepository()
      .listAccounts(token)
      .then((rows) => {
        if (active) setAccounts(rows);
      })
      .catch((caught: unknown) => {
        if (active) setAccountsError(messageOf(caught));
      });
    return () => {
      active = false;
    };
  }, [category, token]);

  useEffect(() => {
    if (category !== "scheduling" || user?.role !== "coordinator") return;
    let active = true;
    getWorkspaceRepository()
      .getRosterPolicy()
      .then((view) => {
        if (!active) return;
        setPolicyLevels(view.levels);
        setPolicy(view.policy);
        setPolicyError("");
      })
      .catch((caught: unknown) => {
        if (active) setPolicyError(messageOf(caught));
      });
    return () => {
      active = false;
    };
  }, [category, user?.role]);

  /** Applies one field to the draft, so a half-finished edit is never saved. */
  function changePolicy(patch: Partial<RosterPolicy>) {
    setPolicy((current) => (current ? { ...current, ...patch } : current));
    setPolicyError("");
    setPolicySaved("");
  }

  async function saveMatchingPolicy() {
    if (!policy) return;
    setPolicyBusy(true);
    setPolicyError("");
    try {
      const view = await actions.updateRosterPolicy(policy);
      setPolicy(view.policy);
      setPolicyLevels(view.levels);
      setPolicySaved(
        `Matching policy saved as version ${view.policy.version}. Every plan from now on records that version.`,
      );
    } catch (caught) {
      setPolicyError(messageOf(caught));
    } finally {
      setPolicyBusy(false);
    }
  }

  async function resetAccountPassword() {
    if (!token || !resetFor) {
      setAccountsError("Choose an account to reset.");
      return;
    }
    if (newPassword.length < 8) {
      setAccountsError("Use at least 8 characters for the new password.");
      return;
    }
    setResetBusy(true);
    setAccountsError("");
    try {
      await getWorkspaceRepository().resetPassword(token, resetFor, newPassword);
      const target = accounts.find((account) => account.id === resetFor);
      setNewPassword("");
      setResetFor("");
      if (target?.id === user?.id) {
        setSaved("Password changed. Sign in again with the new password.");
        await signOut();
      } else {
        setSaved(`Password reset for ${target?.email ?? "the selected account"}.`);
      }
    } catch (caught) {
      setAccountsError(messageOf(caught));
    } finally {
      setResetBusy(false);
    }
  }

  async function uploadCover(file: File | undefined) {
    if (!file) return;
    try {
      const src = await coverPhoto(file);
      setCover({ src, alt: `${orgName.trim() || "Organization"} cover photo` });
      setError("");
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function saveGeneral() {
    if (!orgName.trim()) {
      setError("Organization name is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid contact email.");
      return;
    }
    if (stateValue && !stateCode(stateValue)) {
      setError("Select a state from the list.");
      return;
    }
    if (!user) return;
    // The organization card, the public profile, and every report read this
    // record, so the details live there rather than only in local settings.
    await updateOrganizationDetails(user, workspace.organization.id, {
      name: orgName.trim(),
      description: mission.trim(),
      address: address.trim(),
      city: city.trim(),
      state: stateValue,
      website: website.trim(),
    });
    await updateOrganizationCover(user, workspace.organization.id, cover.src, cover.alt);
    actions.updateSettings({
      organizationName: orgName.trim(),
      contactEmail: email.trim(),
      timezone,
      weekStartsOn: weekStart as "monday" | "sunday",
      defaultShiftLength: Number(shiftLength) || 180,
    });
    setError("");
    setSaved("Workspace settings saved to this device and recorded in the audit log.");
  }

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
                setError("");
              }}
            >
              <item.icon size={14} aria-hidden="true" />
              {t(item.label)}
            </button>
          ))}
        </nav>

        <Card className={styles.settingsCard}>
          {category === "general" ? (
            <>
              <h2 className={styles.settingsTitle}>Organization profile</h2>
              <p className={styles.settingsSub}>
                These details appear across opportunity pages, reports, and service verification
                records.
              </p>
              <div className={styles.formGrid}>
                <TextField
                  label="Organization name"
                  value={orgName}
                  onChange={(event) => {
                    setOrgName(event.target.value);
                    setError("");
                  }}
                />
                <TextField
                  label="Contact email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError("");
                  }}
                />
                <SelectField
                  label="Timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  <option value="America/New_York">Eastern · America/New_York</option>
                  <option value="America/Chicago">Central · America/Chicago</option>
                  <option value="America/Denver">Mountain · America/Denver</option>
                  <option value="America/Los_Angeles">Pacific · America/Los_Angeles</option>
                </SelectField>
                <SelectField
                  label="Week starts on"
                  value={weekStart}
                  onChange={(event) =>
                    setWeekStart(event.target.value === "sunday" ? "sunday" : "monday")
                  }
                >
                  <option value="monday">Monday</option>
                  <option value="sunday">Sunday</option>
                </SelectField>
                <TextField
                  label="Default shift length (minutes)"
                  type="number"
                  min={30}
                  max={720}
                  step={15}
                  value={shiftLength}
                  onChange={(event) => setShiftLength(event.target.value)}
                />
                <div style={{ gridColumn: "1 / -1" }}>
                  <TextareaField
                    label="Mission"
                    value={mission}
                    rows={3}
                    hint={
                      mission.trim().length >= 20
                        ? undefined
                        : "Write at least one sentence so volunteers understand the mission."
                    }
                    onChange={(event) => {
                      setMission(event.target.value);
                      setError("");
                    }}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <TextField
                    label="Street address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </div>
                <TextField
                  label="City"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                />
                <SelectField
                  label="State"
                  value={stateValue}
                  onChange={(event) => {
                    setStateValue(stateCode(event.target.value));
                    setError("");
                  }}
                >
                  <option value="">Select a state</option>
                  {US_STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </SelectField>
                <div style={{ gridColumn: "1 / -1" }}>
                  <TextField
                    label="Website"
                    value={website}
                    placeholder="example.org"
                    onChange={(event) => setWebsite(event.target.value)}
                  />
                </div>
              </div>

              <p style={{ marginTop: 18, fontSize: 13.5, fontWeight: 590 }}>{t("Cover photo")}</p>
              <p className={styles.settingsSub}>
                Used on your public card. Pick a sample or upload your own photo.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 10,
                  maxWidth: 420,
                  marginTop: 12,
                }}
              >
                {ORGANIZATION_COVERS.map((option) => (
                  <button
                    key={option.src}
                    type="button"
                    aria-label={`Use photo: ${option.alt}`}
                    aria-pressed={cover.src === option.src}
                    onClick={() => setCover(option)}
                    style={{
                      position: "relative",
                      padding: 0,
                      width: "100%",
                      aspectRatio: "8 / 5",
                      border: `2px solid ${cover.src === option.src ? "var(--color-lime)" : "transparent"}`,
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "none",
                      cursor: "pointer",
                    }}
                  >
                    <img
                      src={option.src}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    {cover.src === option.src ? (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          right: 4,
                          bottom: 4,
                          display: "grid",
                          placeItems: "center",
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "var(--color-lime)",
                          color: "var(--color-navy)",
                        }}
                      >
                        <Check size={11} aria-hidden="true" />
                      </span>
                    ) : null}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label={t("Upload")}
                  aria-pressed={cover.src.startsWith("data:")}
                  onClick={() => coverInput.current?.click()}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    padding: 0,
                    width: "100%",
                    aspectRatio: "8 / 5",
                    border: "1px dashed var(--border-strong)",
                    borderRadius: 8,
                    background: "var(--surface-raised)",
                    color: "var(--text-secondary)",
                    fontSize: 11.5,
                    fontWeight: 560,
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                >
                  {cover.src.startsWith("data:") ? (
                    <img
                      src={cover.src}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <>
                      <ImagePlus size={16} aria-hidden="true" />
                      {t("Upload")}
                    </>
                  )}
                </button>
                <input
                  ref={coverInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    void uploadCover(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <Toggle
                  label="Require coordinator approval for hours"
                  hint="Only approved minutes appear on verification documents and reports."
                  checked={session.settings.hoursRequireApproval}
                  onChange={(checked) => actions.updateSettings({ hoursRequireApproval: checked })}
                />
                <Toggle
                  label="Email me a weekly summary"
                  hint="Uses the contact email above. No email is sent in the local demo."
                  checked={session.settings.emailDigest === "weekly"}
                  onChange={(checked) =>
                    actions.updateSettings({ emailDigest: checked ? "weekly" : "off" })
                  }
                />
              </div>
              {error ? (
                <p
                  style={{ marginTop: 10, fontSize: 13, color: "var(--tone-red-ink)" }}
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              {saved ? (
                <p
                  style={{ marginTop: 10, fontSize: 13, color: "var(--tone-green-ink)" }}
                  role="status"
                >
                  {saved}
                </p>
              ) : null}
              <div className={styles.saveRow}>
                <Button
                  variant="primary"
                  icon={<Save size={13} />}
                  onClick={() => void saveGeneral()}
                >
                  Save changes
                </Button>
              </div>
            </>
          ) : null}

          {category === "accounts" ? (
            <>
              <h2 className={styles.settingsTitle}>Local accounts</h2>
              <p className={styles.settingsSub}>
                Two roles share this device. Passwords are hashed with Argon2 and sessions expire
                automatically. Resetting a password signs that account out everywhere on this
                device.
              </p>
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 12px",
                      border: "1px solid var(--border-soft)",
                      borderRadius: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 590 }}>{account.name}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                        {account.email} · {account.role}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="small"
                      icon={<KeyRound size={13} />}
                      onClick={() => {
                        setResetFor(account.id);
                        setNewPassword("");
                        setAccountsError("");
                        setSaved("");
                      }}
                    >
                      Reset password
                    </Button>
                  </div>
                ))}
              </div>
              {resetFor ? (
                <div style={{ marginTop: 14, maxWidth: 360 }}>
                  <TextField
                    label={`New password for ${accounts.find((account) => account.id === resetFor)?.email ?? "account"}`}
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      setAccountsError("");
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => void resetAccountPassword()}
                      disabled={resetBusy}
                    >
                      {resetBusy ? "Saving…" : "Set new password"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        setResetFor("");
                        setNewPassword("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
              {accountsError ? (
                <p
                  style={{ marginTop: 10, fontSize: 13, color: "var(--tone-red-ink)" }}
                  role="alert"
                >
                  {accountsError}
                </p>
              ) : null}
              {saved ? (
                <p
                  style={{ marginTop: 10, fontSize: 13, color: "var(--tone-green-ink)" }}
                  role="status"
                >
                  {saved}
                </p>
              ) : null}
              <SharedWorkspaceCard />
            </>
          ) : null}

          {category === "scheduling" ? (
            <>
              <h2 className={styles.settingsTitle}>Scheduling defaults</h2>
              <p className={styles.settingsSub}>
                These rules apply when you create shifts or promote a waitlist candidate.
              </p>
              <div style={{ marginTop: 12 }}>
                <Toggle
                  label="Promote the next eligible waitlist volunteer automatically"
                  hint="When a confirmed volunteer cancels, CivicFlow offers the seat to the next eligible person and records the change."
                  checked={session.settings.autoPromoteWaitlist}
                  onChange={(checked) => {
                    actions.updateSettings({ autoPromoteWaitlist: checked });
                    setSaved(
                      checked ? "Automatic promotion is on." : "Automatic promotion is off.",
                    );
                  }}
                />
                <Toggle
                  label="Default shift length follows the organization setting"
                  hint={`Currently ${session.settings.defaultShiftLength} minutes. New shifts inherit this unless overridden.`}
                  checked={session.settings.defaultShiftLength === 180}
                  onChange={(checked) =>
                    actions.updateSettings({ defaultShiftLength: checked ? 180 : 120 })
                  }
                />
              </div>
              <div className={styles.formGrid}>
                <SelectField
                  label="Default shift length"
                  value={String(session.settings.defaultShiftLength)}
                  onChange={(event) => {
                    actions.updateSettings({ defaultShiftLength: Number(event.target.value) });
                    setSaved("Default shift length updated.");
                  }}
                >
                  <option value="120">2 hours</option>
                  <option value="180">3 hours</option>
                  <option value="240">4 hours</option>
                </SelectField>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 590 }}>Coverage insight</div>
                  <p
                    style={{
                      marginTop: 3,
                      fontSize: 12.5,
                      color: "var(--text-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    AutoRoster uses role requirements, availability, and 7-day rest rules. It never
                    assigns a volunteer to overlapping shifts.
                  </p>
                  <Link to="/coordinator/autoroster" style={{ fontSize: 12.5 }}>
                    Open AutoRoster →
                  </Link>
                </div>
              </div>
              <p
                style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)" }}
                role="status"
              >
                {saved}
              </p>

              {user?.role === "coordinator" ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      marginTop: 24,
                      paddingTop: 16,
                      borderTop: "1px solid var(--border-soft)",
                    }}
                  >
                    <h3 style={{ fontSize: 15, fontWeight: 620 }}>Matching policy</h3>
                    {policy ? <Badge tone="neutral">Version {policy.version}</Badge> : null}
                  </div>
                  <p className={styles.settingsSub}>
                    AutoRoster follows these rules. Saving a change creates a new version, and every
                    plan it produces records the version it used, so a roster can always be
                    explained after the fact. Leave a limit blank for no cap of its own.
                  </p>

                  {policy ? (
                    <>
                      <div className={styles.formGrid}>
                        <TextField
                          label="Maximum shifts per day"
                          type="number"
                          min={1}
                          max={12}
                          value={policy.maxShiftsPerDay ?? ""}
                          hint="Blank means no daily shift cap."
                          onChange={(event) =>
                            changePolicy({ maxShiftsPerDay: limitOrNull(event.target.value) })
                          }
                        />
                        <TextField
                          label="Maximum shifts per week"
                          type="number"
                          min={1}
                          max={40}
                          value={policy.maxShiftsPerWeek ?? ""}
                          hint="Counts shifts already on the books plus new ones."
                          onChange={(event) =>
                            changePolicy({ maxShiftsPerWeek: limitOrNull(event.target.value) })
                          }
                        />
                        <TextField
                          label="Maximum minutes per day"
                          type="number"
                          min={15}
                          max={1440}
                          step={15}
                          value={policy.maxMinutesPerDay ?? ""}
                          hint="Caps time rather than the number of shifts."
                          onChange={(event) =>
                            changePolicy({ maxMinutesPerDay: limitOrNull(event.target.value) })
                          }
                        />
                        <TextField
                          label="Maximum minutes per week"
                          type="number"
                          min={60}
                          max={10080}
                          step={30}
                          value={policy.maxMinutesPerWeek ?? ""}
                          hint="Blank means no weekly minute cap."
                          onChange={(event) =>
                            changePolicy({ maxMinutesPerWeek: limitOrNull(event.target.value) })
                          }
                        />
                        <TextField
                          label="Minimum time between shifts (minutes)"
                          type="number"
                          min={0}
                          max={1440}
                          step={15}
                          value={policy.minimumGapMinutes}
                          hint="Rest either side of a shift. 0 turns it off."
                          onChange={(event) =>
                            changePolicy({ minimumGapMinutes: Number(event.target.value) || 0 })
                          }
                        />
                        <SelectField
                          label="Missing age for an age-restricted role"
                          value={policy.unknownAgeBehavior}
                          onChange={(event) =>
                            changePolicy({
                              unknownAgeBehavior:
                                event.target.value === "allow" ? "allow" : "block",
                            })
                          }
                        >
                          <option value="block">Block the assignment</option>
                          <option value="allow">Allow it</option>
                        </SelectField>
                        <SelectField
                          label="Missing credential for a role that requires one"
                          value={policy.unknownCredentialBehavior}
                          onChange={(event) =>
                            changePolicy({
                              unknownCredentialBehavior:
                                event.target.value === "allow" ? "allow" : "block",
                            })
                          }
                        >
                          <option value="block">Block the assignment</option>
                          <option value="allow">Allow it lightly</option>
                        </SelectField>
                      </div>

                      <p style={{ marginTop: 16, fontSize: 13.5, fontWeight: 620 }}>
                        Match priorities
                      </p>
                      <p className={styles.settingsSub}>
                        Each priority becomes a weight in the match score. Availability is always a
                        requirement, so it is not listed here.
                      </p>
                      <div className={styles.formGrid}>
                        <SelectField
                          label="Skills"
                          value={String(policy.skillWeight)}
                          onChange={(event) =>
                            changePolicy({ skillWeight: Number(event.target.value) })
                          }
                        >
                          {policyLevels.map((level) => (
                            <option key={level.key} value={level.weight}>
                              {levelLabel(level)}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          label="Cause interest"
                          value={String(policy.interestWeight)}
                          onChange={(event) =>
                            changePolicy({ interestWeight: Number(event.target.value) })
                          }
                        >
                          {policyLevels.map((level) => (
                            <option key={level.key} value={level.weight}>
                              {levelLabel(level)}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          label="Language"
                          value={String(policy.languageWeight)}
                          onChange={(event) =>
                            changePolicy({ languageWeight: Number(event.target.value) })
                          }
                        >
                          {policyLevels.map((level) => (
                            <option key={level.key} value={level.weight}>
                              {levelLabel(level)}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          label="Fairness"
                          value={String(policy.fairnessWeight)}
                          onChange={(event) =>
                            changePolicy({ fairnessWeight: Number(event.target.value) })
                          }
                        >
                          {policyLevels.map((level) => (
                            <option key={level.key} value={level.weight}>
                              {levelLabel(level)}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          label="Reliability"
                          value={String(policy.reliabilityWeight)}
                          onChange={(event) =>
                            changePolicy({ reliabilityWeight: Number(event.target.value) })
                          }
                        >
                          {policyLevels.map((level) => (
                            <option key={level.key} value={level.weight}>
                              {levelLabel(level)}
                            </option>
                          ))}
                        </SelectField>
                      </div>

                      {policyError ? (
                        <p
                          style={{ marginTop: 10, fontSize: 13, color: "var(--tone-red-ink)" }}
                          role="alert"
                        >
                          {policyError}
                        </p>
                      ) : null}
                      {policySaved ? (
                        <p
                          style={{ marginTop: 10, fontSize: 13, color: "var(--tone-green-ink)" }}
                          role="status"
                        >
                          {policySaved}
                        </p>
                      ) : null}
                      <div className={styles.saveRow}>
                        <ButtonLink to="/coordinator/autoroster" variant="ghost">
                          See it in AutoRoster
                        </ButtonLink>
                        <Button
                          variant="primary"
                          icon={<Save size={13} />}
                          onClick={() => void saveMatchingPolicy()}
                          disabled={policyBusy}
                        >
                          {policyBusy ? "Saving…" : "Save matching policy"}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p
                      style={{ marginTop: 10, fontSize: 13, color: "var(--tone-red-ink)" }}
                      role="alert"
                    >
                      {policyError || "Loading the matching policy…"}
                    </p>
                  )}
                </>
              ) : null}
            </>
          ) : null}

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
