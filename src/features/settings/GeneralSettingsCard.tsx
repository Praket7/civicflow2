import { useRef, useState } from "react";
import { Check, ImagePlus, Save } from "lucide-react";
import { Button, SelectField, TextareaField, TextField, Toggle } from "../../components/ui";
import { useAuth } from "../../lib/auth/session";
import { messageOf } from "../../lib/errors";
import { t } from "../../lib/i18n";
import { coverPhoto } from "../../lib/images";
import { updateOrganizationCover, updateOrganizationDetails } from "../../lib/organizations/store";
import { ORGANIZATION_COVERS } from "../../lib/organizations/types";
import { US_STATES, stateCode } from "../../lib/us-states";
import { useWorkspace } from "../../lib/workspace/session";
import styles from "../records/Records.module.css";

export function GeneralSettingsCard() {
  const { workspace, session, actions } = useWorkspace();
  const { user } = useAuth();
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
  const coverInput = useRef<HTMLInputElement>(null);

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
    <>
      <h2 className={styles.settingsTitle}>Organization profile</h2>
      <p className={styles.settingsSub}>
        These details appear across opportunity pages, reports, and service verification records.
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
          onChange={(event) => setWeekStart(event.target.value === "sunday" ? "sunday" : "monday")}
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
        <TextField label="City" value={city} onChange={(event) => setCity(event.target.value)} />
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
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--tone-red-ink)" }} role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--tone-green-ink)" }} role="status">
          {saved}
        </p>
      ) : null}
      <div className={styles.saveRow}>
        <Button variant="primary" icon={<Save size={13} />} onClick={() => void saveGeneral()}>
          Save changes
        </Button>
      </div>
    </>
  );
}
