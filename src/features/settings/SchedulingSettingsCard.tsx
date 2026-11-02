import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Save } from "lucide-react";
import { Badge, Button, ButtonLink, SelectField, TextField, Toggle } from "../../components/ui";
import { useAuth } from "../../lib/auth/session";
import { messageOf } from "../../lib/errors";
import { getWorkspaceRepository } from "../../lib/workspace/repository";
import { useWorkspace } from "../../lib/workspace/session";
import type { PriorityLevel, RosterPolicy } from "../../types/domain";
import styles from "../records/Records.module.css";

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

export function SchedulingSettingsCard() {
  const { session, actions } = useWorkspace();
  const { user } = useAuth();
  const [saved, setSaved] = useState("");
  const [policyLevels, setPolicyLevels] = useState<PriorityLevel[]>([]);
  const [policy, setPolicy] = useState<RosterPolicy | null>(null);
  const [policyError, setPolicyError] = useState("");
  const [policySaved, setPolicySaved] = useState("");
  const [policyBusy, setPolicyBusy] = useState(false);

  useEffect(() => {
    if (user?.role !== "coordinator") return;
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
  }, [user?.role]);

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

  return (
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
            setSaved(checked ? "Automatic promotion is on." : "Automatic promotion is off.");
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
            AutoRoster uses role requirements, availability, and 7-day rest rules. It never assigns
            a volunteer to overlapping shifts.
          </p>
          <Link to="/coordinator/autoroster" style={{ fontSize: 12.5 }}>
            Open AutoRoster →
          </Link>
        </div>
      </div>
      <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)" }} role="status">
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
            AutoRoster follows these rules. Saving a change creates a new version, and every plan it
            produces records the version it used, so a roster can always be explained after the
            fact. Leave a limit blank for no cap of its own.
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
                      unknownAgeBehavior: event.target.value === "allow" ? "allow" : "block",
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
                      unknownCredentialBehavior: event.target.value === "allow" ? "allow" : "block",
                    })
                  }
                >
                  <option value="block">Block the assignment</option>
                  <option value="allow">Allow it lightly</option>
                </SelectField>
              </div>

              <p style={{ marginTop: 16, fontSize: 13.5, fontWeight: 620 }}>Match priorities</p>
              <p className={styles.settingsSub}>
                Each priority becomes a weight in the match score. Availability is always a
                requirement, so it is not listed here.
              </p>
              <div className={styles.formGrid}>
                <SelectField
                  label="Skills"
                  value={String(policy.skillWeight)}
                  onChange={(event) => changePolicy({ skillWeight: Number(event.target.value) })}
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
                  onChange={(event) => changePolicy({ interestWeight: Number(event.target.value) })}
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
                  onChange={(event) => changePolicy({ languageWeight: Number(event.target.value) })}
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
                  onChange={(event) => changePolicy({ fairnessWeight: Number(event.target.value) })}
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
            <p style={{ marginTop: 10, fontSize: 13, color: "var(--tone-red-ink)" }} role="alert">
              {policyError || "Loading the matching policy…"}
            </p>
          )}
        </>
      ) : null}
    </>
  );
}
