import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AvailabilitySlot, Cause, DayKey, PeriodKey, Volunteer } from "../../types/domain";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Page,
  PageHeader,
  SectionHeader,
  TextField,
} from "../../components/ui";
import { SetupShell } from "../../components/layout/SetupShell";
import { useAuth } from "../../lib/auth/session";
import { t } from "../../lib/i18n";
import { profilePhoto } from "../../lib/images";
import { completeSetup } from "../../lib/onboarding/store";
import { organizationsFor } from "../../lib/organizations/store";
import {
  CAUSE_LABELS,
  currentVolunteer,
  formatDate,
  formatTime,
  getMatches,
  getUpcomingShiftRows,
} from "../../lib/workspace/selectors";
import { useWorkspace } from "../../lib/workspace/session";
import styles from "./OnboardingPage.module.css";
import { messageOf } from "../../lib/errors";

const SKILL_OPTIONS = [
  "Spanish",
  "Food handling",
  "Tutoring",
  "Event setup",
  "Gardening",
  "Customer service",
  "Leadership",
  "Technology",
  "Driver",
  "CPR",
];

const CAUSE_OPTIONS: Cause[] = [
  "food",
  "education",
  "environment",
  "health",
  "community",
  "animals",
];

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const SKILL_TONES = ["teal", "cobalt", "violet", "amber", "green", "cyan"];

const STEPS = ["Profile", "Skills & interests", "Availability", "Preferences"];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspace, session, actions } = useWorkspace();
  const baseVolunteer = currentVolunteer(workspace);
  const profile = session.volunteerProfile;

  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState(profile.phone ?? baseVolunteer.phone);
  const [photo, setPhoto] = useState(profile.photo ?? baseVolunteer.photo ?? "");
  const [interests, setInterests] = useState(profile.interests ?? baseVolunteer.interests);
  const photoInput = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<string[]>(() => profile.skills);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>(() => profile.availability);
  const [causes, setCauses] = useState<Cause[]>(() => profile.causes ?? baseVolunteer.causes);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await profilePhoto(file));
      setError("");
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  function toggleSkill(skill: string) {
    setError("");
    setSkills((current) =>
      current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill],
    );
  }

  function toggleCause(cause: Cause) {
    setError("");
    setCauses((current) =>
      current.includes(cause) ? current.filter((item) => item !== cause) : [...current, cause],
    );
  }

  function toggleSlot(day: DayKey, period: PeriodKey) {
    setError("");
    const candidate: AvailabilitySlot = { day, period };
    setAvailability((current) =>
      current.some((slot) => slot.day === day && slot.period === period)
        ? current.filter((slot) => slot.day !== day || slot.period !== period)
        : [...current, candidate],
    );
  }

  const previewVolunteer: Volunteer = {
    ...baseVolunteer,
    skills,
    availability,
    causes,
    interests,
    phone,
    photo,
  };

  const rankedMatches = getMatches(
    previewVolunteer,
    8,
    workspace,
    session.createdOpportunities,
  ).filter((match) => match.score >= 70);
  const previewMatches = rankedMatches.slice(0, 3);
  const allSkills = [...new Set([...SKILL_OPTIONS, ...baseVolunteer.skills])];

  function validate(target: number): string {
    if (target === 1 && phone.replace(/\D/g, "").length < 7) {
      return "Add a phone number a coordinator can reach you on.";
    }
    if (target === 2 && skills.length === 0) {
      return "Choose at least one skill so matches stay explainable.";
    }
    if (target === 3 && availability.length === 0) {
      return "Add at least one availability window before continuing.";
    }
    if (target === 4 && causes.length === 0) {
      return "Pick at least one cause you want to hear about.";
    }
    return "";
  }

  function advance() {
    const problem = validate(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setStep((current) => Math.min(STEPS.length, current + 1));
  }

  function goBack() {
    setError("");
    setStep((current) => Math.max(1, current - 1));
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    const problem = validate(STEPS.length);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    await actions.saveVolunteerProfile({
      skills,
      availability,
      completedOnboarding: true,
      phone: phone.trim(),
      interests: interests.trim(),
      causes,
      photo,
    });
    if (user) completeSetup(user.email);
    setSaving(false);
    // Setup gives a profile, not a team; joiners pick an organization first.
    const hasOrganization = user ? organizationsFor(user.email).length > 0 : false;
    navigate(hasOrganization ? "/volunteer/home" : "/volunteer/start", { replace: true });
  }

  return (
    <SetupShell
      label={t("Volunteer setup · Step {step} of {total}", { step, total: STEPS.length })}
    >
      <Page className={styles.page}>
        <ol className={styles.steps} aria-label="Onboarding progress">
          {STEPS.map((label, index) => {
            const number = index + 1;
            const state = number < step ? "done" : number === step ? "active" : "upcoming";
            return (
              <li key={label} className={styles.step} data-state={state}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {state === "done" ? <Check size={12} strokeWidth={2.6} /> : number}
                </span>
                <span className={styles.stepLabel}>{t(label)}</span>
                {state === "done" ? <span className="visually-hidden">completed</span> : null}
                {state === "active" ? <span className="visually-hidden">current step</span> : null}
              </li>
            );
          })}
        </ol>

        <PageHeader
          title="Tell us how you can help."
          description="Four short steps. Your answers shape the opportunities CivicFlow suggests, and you can change any of it later from your profile."
        />

        <form className={styles.layout} onSubmit={finish} noValidate>
          <div className={styles.mainColumn}>
            {step === 1 ? (
              <Card padding="loose" className={styles.block}>
                <SectionHeader
                  title="Start with the basics"
                  subtitle="Coordinators use this to reach you about a shift. Your name and email come from the account you just created."
                />
                <div className={styles.fieldStack}>
                  <div className={styles.photoRow}>
                    <Avatar
                      initials={baseVolunteer.initials}
                      src={photo || undefined}
                      tone={baseVolunteer.tone}
                      size={64}
                      label={baseVolunteer.name}
                    />
                    <div className={styles.photoCopy}>
                      <p className={styles.photoLabel}>Profile photo</p>
                      <p className={styles.photoHint}>
                        A face helps coordinators recognize you on site. Optional.
                      </p>
                      <div className={styles.photoActions}>
                        <Button
                          type="button"
                          variant="secondary"
                          size="small"
                          onClick={() => photoInput.current?.click()}
                        >
                          {photo ? "Change photo" : "Upload photo"}
                        </Button>
                        {photo ? (
                          <button
                            type="button"
                            className={styles.photoRemove}
                            onClick={() => setPhoto("")}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <input
                        ref={photoInput}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(event) => {
                          void uploadPhoto(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                  </div>
                  <TextField
                    label="Phone"
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(event) => {
                      setError("");
                      setPhone(event.target.value);
                    }}
                    hint="Only people in your organization see this."
                  />
                  <p className={styles.accountLine}>
                    {baseVolunteer.name} · {baseVolunteer.email}
                  </p>
                </div>
              </Card>
            ) : null}

            {step === 2 ? (
              <>
                <Card padding="loose" className={styles.block}>
                  <SectionHeader
                    title="What are you good at?"
                    subtitle="Pick everything you would be comfortable doing on site. Every match explains itself with these."
                  />
                  <div className={styles.skills} role="group" aria-label="Your skills">
                    {allSkills.map((skill, index) => {
                      const selected = skills.includes(skill);
                      return (
                        <button
                          key={skill}
                          type="button"
                          className={styles.skill}
                          data-tone={SKILL_TONES[index % SKILL_TONES.length]}
                          data-selected={selected}
                          aria-pressed={selected}
                          onClick={() => toggleSkill(skill)}
                        >
                          {selected ? (
                            <Check size={11} strokeWidth={2.8} aria-hidden="true" />
                          ) : null}
                          {skill}
                        </button>
                      );
                    })}
                  </div>
                  <p className={styles.selectionCount} aria-live="polite">
                    {skills.length} {skills.length === 1 ? "skill" : "skills"} selected
                  </p>
                </Card>

                <Card padding="loose" className={styles.block}>
                  <SectionHeader
                    title="In your words"
                    subtitle="What do you want to help with? Coordinators use this when a role is hard to fill."
                  />
                  <label className={styles.textareaLabel} htmlFor="onboarding-interests">
                    Interests and experience
                  </label>
                  <textarea
                    id="onboarding-interests"
                    className={styles.textarea}
                    value={interests}
                    rows={3}
                    onChange={(event) => setInterests(event.target.value)}
                  />
                </Card>
              </>
            ) : null}

            {step === 3 ? (
              <Card padding="loose" className={styles.block}>
                <SectionHeader
                  title="When can you serve?"
                  subtitle="Tap a window to add it. Weekday evenings and weekend mornings cover the most gaps."
                />
                <div className={styles.availability} role="group" aria-label="Weekly availability">
                  <span className={styles.gridCorner} aria-hidden="true" />
                  {DAYS.map((day) => (
                    <span key={day.key} className={styles.dayLabel}>
                      {day.label}
                    </span>
                  ))}
                  {PERIODS.map((period) => (
                    <div key={period.key} className={styles.periodRow}>
                      <span className={styles.periodLabel}>{period.label}</span>
                      {DAYS.map((day) => {
                        const selected = availability.some(
                          (slot) => slot.day === day.key && slot.period === period.key,
                        );
                        return (
                          <button
                            key={`${day.key}-${period.key}`}
                            type="button"
                            className={styles.slot}
                            data-selected={selected}
                            aria-pressed={selected}
                            aria-label={`${day.label} ${period.label}`}
                            onClick={() => toggleSlot(day.key, period.key)}
                          >
                            {selected ? (
                              <Check size={14} strokeWidth={2.6} aria-hidden="true" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <p className={styles.selectionCount} aria-live="polite">
                  {availability.length} of 21 windows selected
                </p>
              </Card>
            ) : null}

            {step === 4 ? (
              <Card padding="loose" className={styles.block}>
                <SectionHeader
                  title="What should we send you?"
                  subtitle="Pick the causes you want to hear about. You can change any of this later in Settings."
                />
                <div className={styles.skills} role="group" aria-label="Causes you care about">
                  {CAUSE_OPTIONS.map((cause) => {
                    const selected = causes.includes(cause);
                    return (
                      <button
                        key={cause}
                        type="button"
                        className={styles.skill}
                        data-selected={selected}
                        aria-pressed={selected}
                        onClick={() => toggleCause(cause)}
                      >
                        {selected ? <Check size={11} strokeWidth={2.8} aria-hidden="true" /> : null}
                        {CAUSE_LABELS[cause]}
                      </button>
                    );
                  })}
                </div>
                <p className={styles.selectionCount} aria-live="polite">
                  {causes.length} {causes.length === 1 ? "cause" : "causes"} selected
                </p>

                <dl className={styles.summary}>
                  <div>
                    <dt>Skills</dt>
                    <dd>{skills.join(", ")}</dd>
                  </div>
                  <div>
                    <dt>Availability</dt>
                    <dd>
                      {availability.length} {availability.length === 1 ? "window" : "windows"} a
                      week
                    </dd>
                  </div>
                  <div>
                    <dt>Contact</dt>
                    <dd>{phone}</dd>
                  </div>
                </dl>
              </Card>
            ) : null}
          </div>

          <aside className={styles.aside} aria-label="Live profile preview">
            <Card padding="loose" className={styles.preview}>
              <p className={styles.previewKicker}>Live profile preview</p>
              <div className={styles.profileHeader}>
                <Avatar
                  initials={baseVolunteer.initials}
                  src={photo || undefined}
                  tone={baseVolunteer.tone}
                  size={56}
                  label={baseVolunteer.name}
                />
                <div>
                  <h2 className={styles.profileName}>{baseVolunteer.name}</h2>
                  <p className={styles.profileMeta}>
                    {workspace.organization.city || workspace.organization.name} · New volunteer
                  </p>
                </div>
              </div>

              <div className={styles.previewSkills}>
                {skills.length === 0 ? (
                  <span className={styles.previewEmpty}>No skills selected yet</span>
                ) : (
                  skills.map((skill) => (
                    <span key={skill} className={styles.previewSkill}>
                      {skill}
                    </span>
                  ))
                )}
              </div>

              <div className={styles.previewDivider} />

              <div className={styles.matchHead}>
                <h3 className={styles.matchTitle}>
                  We found {rankedMatches.length}{" "}
                  {rankedMatches.length === 1 ? "opportunity" : "opportunities"}
                </h3>
                <Check size={15} aria-hidden="true" className={styles.matchIcon} />
              </div>

              {previewMatches.length === 0 ? (
                <p className={styles.previewEmpty}>
                  Nothing is scheduled yet. Matches appear as soon as your organization posts
                  shifts.
                </p>
              ) : (
                <ul className={styles.matchList}>
                  {previewMatches.map((match) => {
                    const nextShift = getUpcomingShiftRows(workspace).find(
                      (row) => row.shift.opportunityId === match.opportunity.id,
                    );
                    return (
                      <li key={match.opportunity.id} className={styles.matchRow}>
                        <div className={styles.matchRowTop}>
                          <span className={styles.matchName}>{match.opportunity.title}</span>
                          {nextShift ? (
                            <span className={styles.matchWhen}>
                              {formatDate(nextShift.shift.startsAt)} ·{" "}
                              {formatTime(nextShift.shift.startsAt)}
                            </span>
                          ) : null}
                        </div>
                        <div className={styles.matchReasons}>
                          <Badge tone={match.score >= 90 ? "green" : "cobalt"}>
                            {match.score}% match
                          </Badge>
                          <span className={styles.matchReason}>
                            {match.reasons[0] ?? "Matches your availability"}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}

              {step < STEPS.length ? (
                // Keyed so the form cannot submit itself a step early.
                <Button
                  key="continue"
                  type="button"
                  variant="primary"
                  size="large"
                  className={styles.saveButton}
                  onClick={advance}
                  icon={<ArrowRight size={15} aria-hidden="true" />}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  key="finish"
                  type="submit"
                  variant="primary"
                  size="large"
                  className={styles.saveButton}
                  disabled={saving}
                  icon={<ArrowRight size={15} aria-hidden="true" />}
                >
                  {saving ? "Saving…" : "Finish setup"}
                </Button>
              )}
              {step > 1 ? (
                <button type="button" className={styles.skip} onClick={goBack}>
                  <ArrowLeft size={12} aria-hidden="true" /> Back
                </button>
              ) : (
                <p className={styles.asideNote}>You can change every answer later in Settings.</p>
              )}
            </Card>
          </aside>
        </form>
      </Page>
    </SetupShell>
  );
}
