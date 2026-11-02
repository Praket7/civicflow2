import { useState } from "react";
import { useCloud } from "../../lib/sync/provider";
import { messageOf } from "../../lib/errors";
import { Button, Card, Field, Input, PageTitle, Pill } from "../ui";
import styles from "../pwa.module.css";
import { CAUSE_LABEL } from "./common";

const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;
const PERIODS = [
  ["morning", "Morning"],
  ["afternoon", "Afternoon"],
  ["evening", "Evening"],
] as const;

export function ProfileScreen() {
  const { view, queue } = useCloud();
  const [name, setName] = useState(view?.name ?? "");
  const [phone, setPhone] = useState(view?.phone ?? "");
  const [interests, setInterests] = useState(view?.interests ?? "");
  const [skills, setSkills] = useState((view?.skills ?? []).join(", "));
  const [causes, setCauses] = useState<string[]>(view?.causes ?? []);
  const [availability, setAvailability] = useState<string[]>(view?.availability ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Initialize the draft once per volunteer. A background pull must not
  // overwrite words someone is still typing.
  if (view && loadedFor !== view.volunteerId) {
    setLoadedFor(view.volunteerId);
    setName(view.name);
    setPhone(view.phone);
    setInterests(view.interests);
    setSkills(view.skills.join(", "));
    setCauses(view.causes);
    setAvailability(view.availability);
  }

  if (!view) return <p className={styles.loading}>Loading profile…</p>;

  const toggle = (value: string) =>
    setAvailability((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );

  return (
    <div className={styles.stack}>
      <PageTitle eyebrow="Profile" title="What coordinators should know." />
      <Card className={styles.profileHead}>
        {view.photo ? (
          <img className={styles.avatarLarge} src={view.photo} alt="" />
        ) : (
          <span className={styles.avatarLarge} aria-hidden>
            {view.initials}
          </span>
        )}
        <div>
          <p className={styles.profileName}>{view.name}</p>
          <p className={styles.muted}>{view.email}</p>
          <p className={styles.muted}>
            Member since{" "}
            {view.memberSince
              ? new Date(view.memberSince).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })
              : "—"}
          </p>
        </div>
      </Card>

      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);
          setProblem(null);
          void queue(
            "SAVE_VOLUNTEER_PROFILE",
            {
              volunteerId: view.volunteerId,
              name: name.trim(),
              firstName: name.trim().split(/\s+/)[0] ?? "",
              phone: phone.trim(),
              interests: interests.trim(),
              causes,
              skills: skills
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
              availability,
              languages: [],
            },
            { [view.volunteerId]: view.rowVersion },
          )
            .then(() => setMessage("Profile saved. It will sync with the shared roster."))
            .catch((caught: unknown) => setProblem(messageOf(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <Card className={styles.formCard}>
          <div className={styles.formGrid}>
            <Field label="Full name">
              <Input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field label="Phone" hint="Only shared with your organization's coordinators.">
              <Input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(555) 010-2048"
              />
            </Field>
          </div>
          <Field label="Skills" hint="Separate with commas.">
            <Input value={skills} onChange={(event) => setSkills(event.target.value)} />
          </Field>
          <Field label="What drew you here?">
            <textarea
              className={styles.textarea}
              value={interests}
              onChange={(event) => setInterests(event.target.value)}
              rows={3}
            />
          </Field>
          <fieldset className={styles.fieldset}>
            <legend className={styles.fieldLabel}>Causes you care about</legend>
            <div className={styles.chips}>
              {Object.entries(CAUSE_LABEL).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={[styles.chip, causes.includes(value) ? styles.chipActive : ""].join(
                    " ",
                  )}
                  onClick={() =>
                    setCauses((current) =>
                      current.includes(value)
                        ? current.filter((entry) => entry !== value)
                        : [...current, value],
                    )
                  }
                  aria-pressed={causes.includes(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card className={styles.formCard}>
          <h2 className={styles.cardTitle}>When you're usually free</h2>
          <div className={styles.availability}>
            {DAYS.map(([day, label]) => (
              <div key={day} className={styles.availabilityRow}>
                <span>{label}</span>
                <div className={styles.availabilityOptions}>
                  {PERIODS.map(([period, periodLabel]) => {
                    const key = `${day}:${period}`;
                    const active = availability.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={[styles.slot, active ? styles.slotOn : ""].join(" ")}
                        aria-pressed={active}
                        onClick={() => toggle(key)}
                      >
                        {periodLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {message ? <p className={styles.success}>{message}</p> : null}
        {problem ? <p className={styles.error}>{problem}</p> : null}
        <Button type="submit" loading={busy}>
          Save profile
        </Button>
      </form>

      <Card>
        <h2 className={styles.cardTitle}>Credentials</h2>
        {view.credentials.length === 0 ? (
          <p className={styles.muted}>No credentials on file.</p>
        ) : (
          <ul className={styles.roles}>
            {view.credentials.map((credential) => (
              <li key={credential.id}>
                <span>{credential.name}</span>
                <Pill
                  tone={
                    credential.status === "current"
                      ? "good"
                      : credential.status === "expiring"
                        ? "warn"
                        : "bad"
                  }
                >
                  {credential.status === "current"
                    ? `Valid to ${credential.validThrough}`
                    : `${credential.status} · ${credential.validThrough}`}
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
