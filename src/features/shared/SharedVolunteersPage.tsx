import { useMemo, useState } from "react";
import { BadgeCheck, Plus, RefreshCw, Save, ShieldCheck, X } from "lucide-react";
import {
  Button,
  CheckboxField,
  Page,
  PageHeader,
  SearchField,
  SelectField,
  TextField,
} from "../../components/ui";
import { isTauri } from "../../lib/platform";
import {
  number,
  text,
  useSharedReplica,
  type SharedReplicaData,
  type SharedRow,
} from "../../lib/sync/sharedReplica";
import {
  createSharedCredentialType,
  saveSharedCredential,
  saveSharedVolunteer,
  setSharedVolunteerAvailability,
  setSharedVolunteerSkills,
  type AvailabilitySlot,
  type VolunteerPatch,
} from "../../lib/sync/writes";
import { SharedNav } from "./SharedNav";
import styles from "./shared.module.css";

const DAYS = [
  { id: "mon", short: "Mon", label: "Monday" },
  { id: "tue", short: "Tue", label: "Tuesday" },
  { id: "wed", short: "Wed", label: "Wednesday" },
  { id: "thu", short: "Thu", label: "Thursday" },
  { id: "fri", short: "Fri", label: "Friday" },
  { id: "sat", short: "Sat", label: "Saturday" },
  { id: "sun", short: "Sun", label: "Sunday" },
] as const;

const PERIODS = [
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
] as const;

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "onboarding", label: "Onboarding" },
  { value: "inactive", label: "Inactive" },
];

function list(row: SharedRow | undefined, key: string): string[] {
  const value = row?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isoDate(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function dateValue(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function prettyDate(value: unknown): string {
  if (typeof value !== "string" || value === "") return "No date";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date);
}

function initialsFor(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

type CredentialState = "verified" | "expiring" | "expired" | "unverified";

function credentialState(row: SharedRow): CredentialState {
  const through = dateValue(row.valid_through);
  if (through) {
    const end = new Date(`${through}T23:59:59`);
    const today = new Date();
    if (!Number.isNaN(end.getTime()) && end.getTime() < today.getTime()) return "expired";
    const soon = new Date();
    soon.setDate(soon.getDate() + 60);
    if (!Number.isNaN(end.getTime()) && end.getTime() <= soon.getTime()) return "expiring";
  }
  return text(row, "verified_at") ? "verified" : "unverified";
}

function stateLabel(state: CredentialState): string {
  switch (state) {
    case "verified":
      return "Verified";
    case "expiring":
      return "Expiring soon";
    case "expired":
      return "Expired";
    default:
      return "Not verified";
  }
}

function stateClass(state: CredentialState): string {
  if (state === "verified") return styles.pillGood;
  if (state === "expiring") return styles.pillOpen;
  if (state === "expired") return styles.pillBad;
  return "";
}

interface ProfileForm {
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  interests: string;
  languages: string;
  causes: string;
}

function profileFrom(row: SharedRow): ProfileForm {
  return {
    name: text(row, "name"),
    email: text(row, "email"),
    phone: text(row, "phone"),
    role: text(row, "role"),
    status: text(row, "status") || "active",
    interests: text(row, "interests"),
    languages: list(row, "languages").join(", "),
    causes: list(row, "causes").join(", "),
  };
}

interface CredentialForm {
  id: string;
  credentialTypeId: string;
  identifier: string;
  validThrough: string;
  notes: string;
  verified: boolean;
}

function defaultValidThrough(): string {
  const next = new Date();
  next.setFullYear(next.getFullYear() + 1);
  return isoDate(next);
}

function credentialFormFrom(row: SharedRow | null, types: SharedRow[]): CredentialForm {
  if (!row) {
    return {
      id: "",
      credentialTypeId: types[0]?.id ?? "",
      identifier: "",
      validThrough: defaultValidThrough(),
      notes: "",
      verified: false,
    };
  }
  return {
    id: row.id,
    credentialTypeId: text(row, "credential_type_id"),
    identifier: text(row, "identifier"),
    validThrough: dateValue(row.valid_through),
    notes: text(row, "notes"),
    verified: Boolean(text(row, "verified_at")),
  };
}

function skillsOf(data: SharedReplicaData, volunteerId: string): string[] {
  return data.volunteerSkills
    .filter((row) => text(row, "volunteer_id") === volunteerId)
    .map((row) => text(row, "skill"))
    .filter(Boolean)
    .sort();
}

function slotKeysOf(data: SharedReplicaData, volunteerId: string): Set<string> {
  return new Set(
    data.availabilityRules
      .filter((row) => text(row, "volunteer_id") === volunteerId)
      .map((row) => `${text(row, "day")}:${text(row, "period")}`),
  );
}

interface VolunteerDetailProps {
  volunteer: SharedRow;
  data: SharedReplicaData;
  online: boolean;
  reload: () => Promise<void>;
}

/**
 * The editor is keyed by the volunteer and its row version. When the server
 * replaces the record, the editor remounts from the new copy instead of
 * keeping a form that no longer matches; an unrelated pull does not remount it.
 */
function VolunteerDetail({ volunteer, data, online, reload }: VolunteerDetailProps) {
  const [profile, setProfile] = useState<ProfileForm>(() => profileFrom(volunteer));
  const [skills, setSkills] = useState<string[]>(() => skillsOf(data, volunteer.id));
  const [skillDraft, setSkillDraft] = useState("");
  const [slots, setSlots] = useState<Set<string>>(() => slotKeysOf(data, volunteer.id));
  const [credentialForm, setCredentialForm] = useState<CredentialForm | null>(null);
  const [typeForm, setTypeForm] = useState<{ name: string; months: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; message: string } | null>(null);

  const types = useMemo(
    () => [...data.credentialTypes].sort((a, b) => text(a, "name").localeCompare(text(b, "name"))),
    [data.credentialTypes],
  );
  const credentials = useMemo(
    () =>
      data.credentials
        .filter((row) => text(row, "volunteer_id") === volunteer.id)
        .sort((a, b) => dateValue(a.valid_through).localeCompare(dateValue(b.valid_through))),
    [data.credentials, volunteer.id],
  );
  const savedSkills = useMemo(() => skillsOf(data, volunteer.id), [data, volunteer.id]);
  const savedSlots = useMemo(() => slotKeysOf(data, volunteer.id), [data, volunteer.id]);
  const skillsDirty = useMemo(
    () => [...skills].sort().join("\u0000") !== [...savedSkills].sort().join("\u0000"),
    [skills, savedSkills],
  );
  const slotsDirty = useMemo(
    () => [...slots].sort().join("\u0000") !== [...savedSlots].sort().join("\u0000"),
    [slots, savedSlots],
  );

  function flash(tone: "good" | "bad", message: string) {
    setNotice({ tone, message });
  }

  async function run(key: string, action: () => Promise<void>, success: string) {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      flash("good", success);
      await reload();
    } catch (caught) {
      flash("bad", caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  function saveProfile() {
    if (profile.name.trim() === "") {
      flash("bad", "A volunteer needs a name.");
      return;
    }
    const patch: VolunteerPatch = {
      name: profile.name.trim(),
      email: profile.email.trim(),
      phone: profile.phone.trim(),
      role: profile.role.trim(),
      status: profile.status as VolunteerPatch["status"],
      interests: profile.interests.trim(),
      languages: splitList(profile.languages),
      causes: splitList(profile.causes),
    };
    void run("profile", () => saveSharedVolunteer(volunteer, patch), "Profile queued.");
  }

  function addSkill() {
    const next = skillDraft.trim();
    if (!next) return;
    if (skills.some((skill) => skill.toLowerCase() === next.toLowerCase())) {
      flash("bad", `${next} is already on this volunteer.`);
      return;
    }
    if (skills.length >= 24) {
      flash("bad", "A volunteer can list at most 24 skills.");
      return;
    }
    setSkills((current) => [...current, next].sort());
    setSkillDraft("");
  }

  function toggleSlot(day: string, period: string) {
    const key = `${day}:${period}`;
    setSlots((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function saveCredential() {
    if (!credentialForm) return;
    if (!credentialForm.credentialTypeId) {
      flash("bad", "Choose a credential type first.");
      return;
    }
    if (!credentialForm.validThrough) {
      flash("bad", "A credential needs a valid-through date.");
      return;
    }
    const existing = credentialForm.id
      ? (credentials.find((row) => row.id === credentialForm.id) ?? null)
      : null;
    const input = {
      credentialTypeId: credentialForm.credentialTypeId,
      identifier: credentialForm.identifier.trim(),
      validThrough: credentialForm.validThrough,
      notes: credentialForm.notes.trim(),
      verified: credentialForm.verified,
    };
    void run(
      "credential",
      async () => {
        await saveSharedCredential(volunteer.id, existing, input);
        setCredentialForm(null);
      },
      existing ? "Credential change queued." : "Credential queued.",
    );
  }

  function saveType() {
    if (!typeForm) return;
    const name = typeForm.name.trim();
    const months = Math.trunc(Number(typeForm.months));
    if (!name) {
      flash("bad", "Give the credential type a name.");
      return;
    }
    if (!Number.isFinite(months) || months < 1 || months > 120) {
      flash("bad", "Validity has to be between one and 120 months.");
      return;
    }
    void run(
      "type",
      async () => {
        await createSharedCredentialType(name, months);
        setTypeForm(null);
      },
      "Credential type queued.",
    );
  }

  return (
    <div className={styles.volunteerDetail}>
      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className={[
            styles.notice,
            notice.tone === "bad" ? styles.noticeError : styles.noticeGood,
          ].join(" ")}
        >
          {notice.message}
        </p>
      ) : null}

      <section className={styles.panel} aria-labelledby="shared-volunteer-profile">
        <div className={styles.panelHead}>
          <div>
            <h2 id="shared-volunteer-profile" className={styles.panelTitle}>
              Profile
            </h2>
            <p className={styles.panelCopy}>
              Contact details and roster status. Changing a status never deletes attendance or hour
              history.
            </p>
          </div>
          <Button
            variant="primary"
            size="small"
            icon={<Save aria-hidden size={13} />}
            disabled={busy !== ""}
            onClick={saveProfile}
          >
            {busy === "profile" ? "Saving…" : "Save profile"}
          </Button>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.detailIdentity}>
            <span className={styles.detailAvatar} aria-hidden>
              {initialsFor(profile.name)}
            </span>
            <div>
              <p className={styles.detailName}>{profile.name || "Unnamed volunteer"}</p>
              <p className={styles.detailMeta}>
                Joined {prettyDate(volunteer.joined_at)} · {number(volunteer, "events_completed")}{" "}
                events ·{" "}
                {number(volunteer, "hours_verified").toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}{" "}
                hours verified
              </p>
            </div>
            <span
              className={`${styles.pill} ${
                text(volunteer, "status") === "active" ? styles.pillGood : styles.pillOpen
              }`}
            >
              {text(volunteer, "status") || "active"}
            </span>
          </div>

          <div className={`${styles.formGrid} ${styles.spaceTop}`}>
            <TextField
              label="Name"
              value={profile.name}
              onChange={(event) => setProfile({ ...profile, name: event.target.value })}
            />
            <SelectField
              label="Status"
              value={profile.status}
              onChange={(event) => setProfile({ ...profile, status: event.target.value })}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Email"
              type="email"
              value={profile.email}
              onChange={(event) => setProfile({ ...profile, email: event.target.value })}
            />
            <TextField
              label="Phone"
              type="tel"
              value={profile.phone}
              onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
            />
            <TextField
              label="Roster role"
              hint="Shown on schedules. Access comes from organization membership."
              value={profile.role}
              onChange={(event) => setProfile({ ...profile, role: event.target.value })}
            />
            <TextField
              label="Languages"
              hint="Separate with commas."
              value={profile.languages}
              onChange={(event) => setProfile({ ...profile, languages: event.target.value })}
            />
            <TextField
              label="Causes"
              hint="Separate with commas."
              value={profile.causes}
              onChange={(event) => setProfile({ ...profile, causes: event.target.value })}
            />
            <TextField
              label="Interests"
              value={profile.interests}
              onChange={(event) => setProfile({ ...profile, interests: event.target.value })}
            />
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="shared-volunteer-skills">
        <div className={styles.panelHead}>
          <div>
            <h2 id="shared-volunteer-skills" className={styles.panelTitle}>
              Skills
            </h2>
            <p className={styles.panelCopy}>
              A skill is a name, not a record. Saving replaces the whole set, so a retry cannot
              duplicate it.
            </p>
          </div>
          <Button
            variant="secondary"
            size="small"
            disabled={!skillsDirty || busy !== ""}
            onClick={() =>
              void run(
                "skills",
                () => setSharedVolunteerSkills(volunteer.id, skills),
                "Skills queued.",
              )
            }
          >
            {busy === "skills" ? "Saving…" : "Save skills"}
          </Button>
        </div>
        <div className={styles.panelBody}>
          {skills.length === 0 ? (
            <p className={styles.panelCopy}>No skills listed yet.</p>
          ) : (
            <ul className={styles.chipRow} aria-label="Skills">
              {skills.map((skill) => (
                <li key={skill} className={styles.chip}>
                  {skill}
                  <button
                    type="button"
                    aria-label={`Remove ${skill}`}
                    className={styles.chipRemove}
                    onClick={() => setSkills((current) => current.filter((item) => item !== skill))}
                  >
                    <X aria-hidden size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.inlineAdd}>
            <TextField
              label="Add a skill"
              value={skillDraft}
              placeholder="Driving"
              onChange={(event) => setSkillDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addSkill();
                }
              }}
            />
            <Button
              variant="secondary"
              icon={<Plus aria-hidden size={13} />}
              disabled={skillDraft.trim() === ""}
              onClick={addSkill}
            >
              Add
            </Button>
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="shared-volunteer-availability">
        <div className={styles.panelHead}>
          <div>
            <h2 id="shared-volunteer-availability" className={styles.panelTitle}>
              Weekly availability
            </h2>
            <p className={styles.panelCopy}>
              Three windows a day. AutoRoster and the server both read this before placing someone.
            </p>
          </div>
          <Button
            variant="secondary"
            size="small"
            disabled={!slotsDirty || busy !== ""}
            onClick={() =>
              void run(
                "availability",
                () =>
                  setSharedVolunteerAvailability(
                    volunteer.id,
                    [...slots].map((key) => {
                      const [day, period] = key.split(":");
                      return {
                        day: day as AvailabilitySlot["day"],
                        period: period as AvailabilitySlot["period"],
                      };
                    }),
                  ),
                "Availability queued.",
              )
            }
          >
            {busy === "availability" ? "Saving…" : "Save availability"}
          </Button>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.slotGrid} role="group" aria-label="Weekly slots">
            <span />
            {DAYS.map((day) => (
              <span key={day.id} className={styles.slotHead}>
                {day.short}
              </span>
            ))}
            {PERIODS.map((period) => (
              <div key={period.id} className={styles.slotRow}>
                <span className={styles.slotHead}>{period.label}</span>
                {DAYS.map((day) => {
                  const key = `${day.id}:${period.id}`;
                  const on = slots.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={`${day.label} ${period.label.toLowerCase()}`}
                      aria-pressed={on}
                      className={[styles.slotButton, on ? styles.slotButtonOn : ""]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => toggleSlot(day.id, period.id)}
                    >
                      {on ? "Available" : "—"}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="shared-volunteer-credentials">
        <div className={styles.panelHead}>
          <div>
            <h2 id="shared-volunteer-credentials" className={styles.panelTitle}>
              Credentials
            </h2>
            <p className={styles.panelCopy}>
              A coordinator verifies a document; the volunteer can still add their own. Validity is
              checked through the shift date.
            </p>
          </div>
          <div className={styles.actions}>
            <Button
              variant="ghost"
              size="small"
              icon={<ShieldCheck aria-hidden size={13} />}
              onClick={() => setTypeForm({ name: "", months: "24" })}
            >
              New credential type
            </Button>
            <Button
              variant="primary"
              size="small"
              icon={<Plus aria-hidden size={13} />}
              disabled={types.length === 0}
              onClick={() => setCredentialForm(credentialFormFrom(null, types))}
            >
              Add credential
            </Button>
          </div>
        </div>
        <div className={styles.panelBody}>
          {types.length === 0 ? (
            <p className={styles.panelCopy}>
              This organization has no credential types yet. Add one below, then a volunteer can be
              given a credential.
            </p>
          ) : credentials.length === 0 ? (
            <p className={styles.panelCopy}>No credentials on file.</p>
          ) : (
            <ul className={styles.credentialList}>
              {credentials.map((row) => {
                const state = credentialState(row);
                const type = types.find((item) => item.id === text(row, "credential_type_id"));
                return (
                  <li key={row.id} className={styles.credentialRow}>
                    <span className={styles.credentialIcon} aria-hidden>
                      <BadgeCheck size={15} />
                    </span>
                    <div className={styles.credentialCopy}>
                      <p className={styles.credentialName}>{text(type, "name") || "Credential"}</p>
                      <p className={styles.credentialMeta}>
                        {text(row, "identifier") || "No identifier"} · valid through{" "}
                        {prettyDate(row.valid_through)}
                        {text(row, "verified_at")
                          ? ` · verified ${prettyDate(row.verified_at)}`
                          : ""}
                      </p>
                    </div>
                    <span className={`${styles.pill} ${stateClass(state)}`}>
                      {stateLabel(state)}
                    </span>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={busy !== ""}
                      onClick={() => setCredentialForm(credentialFormFrom(row, types))}
                    >
                      Edit
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {credentialForm ? (
            <div className={styles.subPanel} aria-labelledby="credential-editor">
              <div className={styles.subPanelHead}>
                <h3 id="credential-editor" className={styles.subPanelTitle}>
                  {credentialForm.id ? "Edit credential" : "New credential"}
                </h3>
                <Button variant="ghost" size="small" onClick={() => setCredentialForm(null)}>
                  Cancel
                </Button>
              </div>
              <div className={`${styles.formGrid} ${styles.spaceTop}`}>
                <SelectField
                  label="Type"
                  value={credentialForm.credentialTypeId}
                  onChange={(event) =>
                    setCredentialForm({ ...credentialForm, credentialTypeId: event.target.value })
                  }
                >
                  <option value="">Choose a type</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {text(type, "name")}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Identifier"
                  value={credentialForm.identifier}
                  placeholder="Certificate number"
                  onChange={(event) =>
                    setCredentialForm({ ...credentialForm, identifier: event.target.value })
                  }
                />
                <TextField
                  label="Valid through"
                  type="date"
                  value={credentialForm.validThrough}
                  onChange={(event) =>
                    setCredentialForm({ ...credentialForm, validThrough: event.target.value })
                  }
                />
                <TextField
                  label="Notes"
                  value={credentialForm.notes}
                  onChange={(event) =>
                    setCredentialForm({ ...credentialForm, notes: event.target.value })
                  }
                />
              </div>
              <div className={styles.spaceTop}>
                <CheckboxField
                  label="Verified by a coordinator"
                  checked={credentialForm.verified}
                  onChange={(event) =>
                    setCredentialForm({ ...credentialForm, verified: event.target.checked })
                  }
                />
              </div>
              <div className={`${styles.actions} ${styles.spaceTop}`}>
                <Button
                  variant="primary"
                  size="small"
                  icon={<Save aria-hidden size={13} />}
                  disabled={busy !== ""}
                  onClick={saveCredential}
                >
                  {busy === "credential" ? "Saving…" : "Save credential"}
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  icon={<ShieldCheck aria-hidden size={13} />}
                  onClick={() => setTypeForm({ name: "", months: "24" })}
                >
                  New credential type
                </Button>
              </div>
            </div>
          ) : null}

          {typeForm ? (
            <div className={styles.subPanel} aria-labelledby="credential-type-editor">
              <div className={styles.subPanelHead}>
                <h3 id="credential-type-editor" className={styles.subPanelTitle}>
                  New credential type
                </h3>
                <Button variant="ghost" size="small" onClick={() => setTypeForm(null)}>
                  Cancel
                </Button>
              </div>
              <div className={`${styles.formGrid} ${styles.spaceTop}`}>
                <TextField
                  label="Name"
                  value={typeForm.name}
                  placeholder="Food handler"
                  onChange={(event) => setTypeForm({ ...typeForm, name: event.target.value })}
                />
                <TextField
                  label="Valid for (months)"
                  type="number"
                  min={1}
                  max={120}
                  value={typeForm.months}
                  onChange={(event) => setTypeForm({ ...typeForm, months: event.target.value })}
                />
              </div>
              <div className={`${styles.actions} ${styles.spaceTop}`}>
                <Button variant="primary" size="small" disabled={busy !== ""} onClick={saveType}>
                  {busy === "type" ? "Saving…" : "Save type"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <p className={styles.muted} style={{ margin: 0, fontSize: 12.5 }}>
        {online
          ? "Connected. A refused edit lands in the conflict center with both values."
          : "Offline. Changes are queued and sent when the organization is reachable."}
      </p>
    </div>
  );
}

export function SharedVolunteersPage() {
  const { sync, data, loading, error, reload } = useSharedReplica();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "attention">("all");
  const [selectedId, setSelectedId] = useState("");

  const sortedVolunteers = useMemo(
    () => [...data.volunteers].sort((a, b) => text(a, "name").localeCompare(text(b, "name"))),
    [data.volunteers],
  );
  const activeId = selectedId || sortedVolunteers[0]?.id || "";
  const volunteer = useMemo(
    () => data.volunteers.find((row) => row.id === activeId) ?? null,
    [data.volunteers, activeId],
  );

  const skillsByVolunteer = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of data.volunteerSkills) {
      const id = text(row, "volunteer_id");
      map.set(id, [...(map.get(id) ?? []), text(row, "skill")]);
    }
    return map;
  }, [data.volunteerSkills]);

  const credentialsByVolunteer = useMemo(() => {
    const map = new Map<string, SharedRow[]>();
    for (const row of data.credentials) {
      const id = text(row, "volunteer_id");
      map.set(id, [...(map.get(id) ?? []), row]);
    }
    return map;
  }, [data.credentials]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortedVolunteers.filter((row) => {
      const id = row.id;
      const haystack = [
        text(row, "name"),
        text(row, "email"),
        text(row, "phone"),
        ...(skillsByVolunteer.get(id) ?? []),
      ]
        .join(" ")
        .toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (filter === "active") return text(row, "status") === "active";
      if (filter === "attention") {
        if (text(row, "status") !== "active") return true;
        return (credentialsByVolunteer.get(id) ?? []).some(
          (credential) => credentialState(credential) === "expired",
        );
      }
      return true;
    });
  }, [sortedVolunteers, query, filter, skillsByVolunteer, credentialsByVolunteer]);

  const stats = useMemo(() => {
    const active = data.volunteers.filter((row) => text(row, "status") === "active").length;
    const skillCount = data.volunteerSkills.length;
    const verified = data.credentials.filter((row) => text(row, "verified_at") !== "").length;
    const expiring = data.credentials.filter(
      (row) => credentialState(row) === "expiring" || credentialState(row) === "expired",
    ).length;
    const hours = data.volunteers.reduce((total, row) => total + number(row, "hours_verified"), 0);
    return { active, skillCount, verified, expiring, hours };
  }, [data]);

  return (
    <Page width="wide">
      <div className={styles.shell}>
        <PageHeader
          eyebrow="Shared coordinator"
          title="Volunteers"
          description="Profiles, skills, weekly availability, and credentials for the shared organization. Every edit is a command, so it works offline and the server refuses a stale copy instead of overwriting it."
          backTo="/shared"
          backLabel="Hosted workspace"
          actions={
            <Button
              variant="secondary"
              icon={<RefreshCw aria-hidden size={14} />}
              disabled={!isTauri()}
              onClick={() => void reload()}
            >
              Sync now
            </Button>
          }
        />

        <SharedNav conflicts={sync.conflicts} />

        {!isTauri() ? (
          <section className={styles.panel}>
            <div className={styles.panelBody}>
              <h2 className={styles.panelTitle}>This screen lives in the desktop app</h2>
              <p className={styles.panelCopy}>
                Volunteer records are written through the encrypted replica on this computer.
              </p>
            </div>
          </section>
        ) : (
          <>
            {error ? (
              <p role="alert" className={`${styles.notice} ${styles.noticeError}`}>
                {error}
              </p>
            ) : null}

            <div className={styles.stats}>
              {[
                ["Active volunteers", stats.active, `${data.volunteers.length} on file`],
                ["Skills listed", stats.skillCount, "shared across the roster"],
                ["Verified credentials", stats.verified, `${stats.expiring} need attention`],
                [
                  "Hours verified",
                  stats.hours.toLocaleString(undefined, { maximumFractionDigits: 1 }),
                  "from every profile",
                ],
              ].map(([label, value, hint]) => (
                <div key={String(label)} className={styles.stat}>
                  <p className={styles.statLabel}>{label}</p>
                  <p className={styles.statValue}>{String(value)}</p>
                  <p className={styles.statHint}>{hint}</p>
                </div>
              ))}
            </div>

            <div className={styles.volunteerBoard}>
              <section className={styles.panel} aria-labelledby="shared-volunteer-directory">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="shared-volunteer-directory" className={styles.panelTitle}>
                      Directory
                    </h2>
                    <p className={styles.panelCopy}>
                      {visible.length} of {data.volunteers.length} people
                    </p>
                  </div>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.directoryTools}>
                    <SearchField
                      value={query}
                      onChange={setQuery}
                      placeholder="Name, email, or skill"
                      label="Search volunteers"
                    />
                    <SelectField
                      label="Show"
                      value={filter}
                      onChange={(event) =>
                        setFilter(event.target.value as "all" | "active" | "attention")
                      }
                    >
                      <option value="all">Everyone</option>
                      <option value="active">Active only</option>
                      <option value="attention">Needs attention</option>
                    </SelectField>
                  </div>

                  {loading && data.volunteers.length === 0 ? (
                    <p className={styles.panelCopy}>Reading the synced copy…</p>
                  ) : visible.length === 0 ? (
                    <p className={styles.panelCopy}>
                      {data.volunteers.length === 0
                        ? "No volunteers have reached this computer yet."
                        : "No volunteer matches that search."}
                    </p>
                  ) : (
                    <ul className={styles.directoryList}>
                      {visible.map((row) => {
                        const rowSkills = skillsByVolunteer.get(row.id) ?? [];
                        const rowCredentials = credentialsByVolunteer.get(row.id) ?? [];
                        const badCredential = rowCredentials.some(
                          (credential) => credentialState(credential) === "expired",
                        );
                        return (
                          <li key={row.id}>
                            <button
                              type="button"
                              className={[
                                styles.personButton,
                                row.id === activeId ? styles.personButtonActive : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              aria-pressed={row.id === activeId}
                              onClick={() => setSelectedId(row.id)}
                            >
                              <span className={styles.personAvatar} aria-hidden>
                                {initialsFor(text(row, "name"))}
                              </span>
                              <span className={styles.personCopy}>
                                <span className={styles.personName}>
                                  {text(row, "name") || "Unnamed volunteer"}
                                </span>
                                <span className={styles.personMeta}>
                                  {text(row, "role") || "Volunteer"} ·{" "}
                                  {rowSkills.length > 0
                                    ? `${rowSkills.length} skill${rowSkills.length === 1 ? "" : "s"}`
                                    : "no skills"}
                                  {rowCredentials.length > 0
                                    ? ` · ${rowCredentials.length} credential${rowCredentials.length === 1 ? "" : "s"}`
                                    : ""}
                                </span>
                              </span>
                              <span className={styles.personFlags}>
                                {text(row, "status") !== "active" ? (
                                  <span className={`${styles.pill} ${styles.pillOpen}`}>
                                    {text(row, "status")}
                                  </span>
                                ) : null}
                                {badCredential ? (
                                  <span className={`${styles.pill} ${styles.pillBad}`}>
                                    expired
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>

              {volunteer ? (
                <VolunteerDetail
                  key={`${volunteer.id}:${String(volunteer.row_version ?? 0)}`}
                  volunteer={volunteer}
                  data={data}
                  online={sync.online}
                  reload={reload}
                />
              ) : (
                <div className={styles.volunteerDetail}>
                  <section className={styles.panel}>
                    <div className={styles.panelBody}>
                      <p className={styles.panelCopy}>
                        Choose a volunteer to see their record. Nothing is copied out of the
                        organization.
                      </p>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
