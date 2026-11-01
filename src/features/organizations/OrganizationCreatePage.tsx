import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Globe2, ImagePlus, Lock, MapPin, Users } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button, SelectField, TextField, TextareaField } from "../../components/ui";
import { useAuth } from "../../lib/auth/session";
import { completeSetup } from "../../lib/onboarding/store";
import { coverPhoto } from "../../lib/images";
import { createOrganization, organizationsFor } from "../../lib/organizations/store";
import type { OrganizationProfile } from "../../lib/organizations/store";
import { ORGANIZATION_COVERS } from "../../lib/organizations/types";
import type { OrganizationVisibility } from "../../lib/organizations/types";
import { US_STATES, stateCode } from "../../lib/us-states";
import styles from "./onboarding.module.css";
import { messageOf } from "../../lib/errors";

interface FormState {
  name: string;
  description: string;
  website: string;
  address: string;
  city: string;
  state: string;
  contactEmail: string;
  secondEmail: string;
}

type Errors = Partial<Record<keyof FormState | "form", string>>;

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function OrganizationCreatePage() {
  const navigate = useNavigate();
  const { user, signOut, refresh } = useAuth();
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    website: "",
    address: "",
    city: "",
    state: "",
    contactEmail: user?.email ?? "",
    secondEmail: "",
  });
  const [cover, setCover] = useState<{ src: string; alt: string }>(ORGANIZATION_COVERS[0]);
  const [visibility, setVisibility] = useState<OrganizationVisibility>("public");
  const [errors, setErrors] = useState<Errors>({});
  const [created, setCreated] = useState<OrganizationProfile | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  async function uploadCover(file: File | undefined) {
    if (!file) return;
    try {
      const src = await coverPhoto(file);
      setCover({ src, alt: `${form.name.trim() || "Organization"} cover photo` });
      setErrors((current) => ({ ...current, form: undefined }));
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        form: messageOf(caught),
      }));
    }
  }

  if (!user) {
    return (
      <main className={styles.screen}>
        <p className={styles.lede}>Sign in as a coordinator to create an organization.</p>
      </main>
    );
  }
  if (user.role === "volunteer") return <Navigate to="/volunteer/start" replace />;
  // Before the first organization this page is the setup gate, so the only way
  // out is signing out.
  const hasOrganization = organizationsFor(user.email).length > 0;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function validate(): Errors {
    const next: Errors = {};
    if (form.name.trim().length < 2) next.name = "Give the organization its public name.";
    if (form.description.trim().length < 20)
      next.description = "Write at least a sentence about what this organization does.";
    if (!form.website.trim()) next.website = "Add a website so volunteers can check you out.";
    if (!form.address.trim()) next.address = "Add the street address volunteers will travel to.";
    if (!form.city.trim()) next.city = "Add the city.";
    if (!stateCode(form.state)) next.state = "Choose the state from the list.";
    if (!isEmail(form.contactEmail))
      next.contactEmail = "Use the email that should receive volunteer questions.";
    if (form.secondEmail.trim() && !isEmail(form.secondEmail))
      next.secondEmail = "That second email does not look right.";
    return next;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      const organization = await createOrganization(user, {
        name: form.name,
        description: form.description,
        website: form.website,
        address: form.address,
        city: form.city,
        state: stateCode(form.state),
        contactEmails: [form.contactEmail, form.secondEmail].filter(Boolean),
        image: cover.src,
        imageAlt: cover.alt,
        visibility,
      });
      completeSetup(user.email);
      // Creating the organization makes this account its owner; the route guard
      // and the shell both read the role from the session.
      await refresh();
      setCreated(organization);
    } catch (caught) {
      setErrors({ form: messageOf(caught) });
    }
  }

  if (created) {
    return (
      <main className={styles.screen}>
        <div className={styles.backRow}>
          {hasOrganization ? (
            <Link className={styles.back} to="/coordinator/start">
              <ArrowLeft size={14} aria-hidden="true" />
              Onboarding
            </Link>
          ) : (
            <button type="button" className={styles.signOut} onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </div>
        <section className={styles.shell} aria-labelledby="created-title">
          <header className={styles.head}>
            <p className={styles.eyebrow}>
              <Check size={13} aria-hidden="true" />
              Workspace created
            </p>
            <h1 className={styles.title} id="created-title">
              {`${created.name} is ready.`}
            </h1>
            <p className={styles.lede}>
              Invite coordinators and volunteers from Organization &amp; access. Every invitation is
              one-time, expires after 14 days, and names the role it grants.
            </p>
          </header>
          <div className={styles.body}>
            <div className={styles.panel}>
              <h2 className={styles.sectionTitle}>Bring the team in</h2>
              <p className={styles.sectionHint}>
                {created.visibility === "public"
                  ? "Public: volunteers can find this organization and join on their own."
                  : "Private: volunteers join only with an invitation from a coordinator."}
              </p>
              <p className={styles.sectionHint}>
                Open Organization &amp; access to invite a coordinator or volunteer by email.
                CivicFlow issues one invitation per person; there is no reusable code to leak or
                rotate.
              </p>
              <div className={styles.actions}>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => navigate("/coordinator/settings", { replace: true })}
                >
                  Invite the team
                </Button>
              </div>
            </div>

            <div className={styles.actions}>
              <Button
                size="large"
                icon={<ArrowRight size={15} />}
                onClick={() => navigate("/coordinator/mission-control", { replace: true })}
              >
                Open workspace
              </Button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <div className={styles.backRow}>
        {hasOrganization ? (
          <Link className={styles.back} to="/coordinator/start">
            <ArrowLeft size={14} aria-hidden="true" />
            Onboarding
          </Link>
        ) : (
          <button type="button" className={styles.signOut} onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </div>

      <section className={styles.shell} aria-labelledby="new-org-title">
        <header className={styles.head}>
          <h1 className={styles.title} id="new-org-title">
            Tell volunteers who you are.
          </h1>
          <p className={styles.lede}>
            These details appear across opportunity pages, reports, and service verification
            records.
          </p>
        </header>

        <div className={styles.body}>
          <form className={styles.twoCol} onSubmit={submit} noValidate>
            <div className={styles.fieldGrid}>
              <div className={styles.full}>
                <TextField
                  label="Organization name"
                  placeholder="Riverside Community Garden"
                  value={form.name}
                  error={errors.name}
                  autoComplete="organization"
                  onChange={(event) => update("name", event.target.value)}
                />
              </div>
              <div className={styles.full}>
                <TextareaField
                  label="What you do"
                  placeholder="Who you serve, when you meet, and what a volunteer's first shift looks like."
                  rows={4}
                  value={form.description}
                  error={errors.description}
                  hint={`${form.description.trim().length} characters · aim for two sentences`}
                  onChange={(event) => update("description", event.target.value)}
                />
              </div>
              <TextField
                label="Website"
                placeholder="riversidegarden.org"
                value={form.website}
                error={errors.website}
                autoComplete="url"
                onChange={(event) => update("website", event.target.value)}
              />
              <TextField
                label="Contact email"
                type="email"
                placeholder="hello@riversidegarden.org"
                value={form.contactEmail}
                error={errors.contactEmail}
                autoComplete="email"
                hint="“Message coordinator” goes here."
                onChange={(event) => update("contactEmail", event.target.value)}
              />
              <TextField
                label="Second contact (optional)"
                type="email"
                placeholder="volunteers@riversidegarden.org"
                value={form.secondEmail}
                error={errors.secondEmail}
                onChange={(event) => update("secondEmail", event.target.value)}
              />
              <TextField
                label="Street address"
                placeholder="218 Riverside Avenue"
                value={form.address}
                error={errors.address}
                autoComplete="street-address"
                onChange={(event) => update("address", event.target.value)}
              />
              <div className={styles.split}>
                <TextField
                  label="City"
                  placeholder="Buffalo"
                  value={form.city}
                  error={errors.city}
                  autoComplete="address-level2"
                  onChange={(event) => update("city", event.target.value)}
                />
                <SelectField
                  label="State"
                  value={form.state}
                  error={errors.state}
                  onChange={(event) => update("state", stateCode(event.target.value))}
                >
                  <option value="">Select a state</option>
                  {US_STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </SelectField>
              </div>

              <fieldset className={`${styles.full} ${styles.panel}`}>
                <legend className={styles.sectionTitle}>Cover photo</legend>
                <p className={styles.sectionHint}>
                  Used on your public card. Pick a sample or upload your own photo.
                </p>
                <div className={styles.coverRow}>
                  {ORGANIZATION_COVERS.map((option) => (
                    <button
                      key={option.src}
                      type="button"
                      className={styles.coverOption}
                      data-active={cover.src === option.src}
                      aria-pressed={cover.src === option.src}
                      aria-label={`Use photo: ${option.alt}`}
                      onClick={() => setCover(option)}
                    >
                      <img src={option.src} alt="" />
                      {cover.src === option.src ? (
                        <span className={styles.coverCheck}>
                          <Check size={11} aria-hidden="true" />
                        </span>
                      ) : null}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.coverOption}
                    data-active={cover.src.startsWith("data:")}
                    aria-pressed={cover.src.startsWith("data:")}
                    aria-label="Upload a cover photo"
                    onClick={() => coverInput.current?.click()}
                  >
                    {cover.src.startsWith("data:") ? (
                      <img src={cover.src} alt="" />
                    ) : (
                      <span className={styles.coverUpload}>
                        <ImagePlus size={16} aria-hidden="true" />
                        Upload
                      </span>
                    )}
                    {cover.src.startsWith("data:") ? (
                      <span className={styles.coverCheck}>
                        <Check size={11} aria-hidden="true" />
                      </span>
                    ) : null}
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
              </fieldset>

              <fieldset className={`${styles.full} ${styles.panel}`}>
                <legend className={styles.sectionTitle}>Who can join</legend>
                <div className={styles.visibility}>
                  <div className={styles.radioCard} data-active={visibility === "public"}>
                    <input
                      id="visibility-public"
                      type="radio"
                      name="visibility"
                      value="public"
                      checked={visibility === "public"}
                      onChange={() => setVisibility("public")}
                    />
                    <label htmlFor="visibility-public">
                      <span className={styles.radioTitle}>Public</span>
                      <span className={styles.radioBody}>
                        Listed in Discover, accepting volunteers, open to join.
                      </span>
                    </label>
                  </div>
                  <div className={styles.radioCard} data-active={visibility === "private"}>
                    <input
                      id="visibility-private"
                      type="radio"
                      name="visibility"
                      value="private"
                      checked={visibility === "private"}
                      onChange={() => setVisibility("private")}
                    />
                    <label htmlFor="visibility-private">
                      <span className={styles.radioTitle}>Private</span>
                      <span className={styles.radioBody}>
                        Private: volunteers join only with an invitation from a coordinator.
                      </span>
                    </label>
                  </div>
                </div>
              </fieldset>

              {errors.form ? (
                <p className={`${styles.full} ${styles.error}`} role="alert">
                  {errors.form}
                </p>
              ) : null}

              <div className={`${styles.full} ${styles.actions}`}>
                <Button type="submit" size="large" icon={<ArrowRight size={15} />}>
                  Create workspace
                </Button>
                <span className={styles.footerNote}>
                  <Users size={12} aria-hidden="true" /> You become the first coordinator.
                </span>
              </div>
            </div>

            <aside className={styles.preview} aria-label="Public card preview">
              <img className={styles.previewImage} src={cover.src} alt={cover.alt} />
              <div className={styles.previewBody}>
                <span className={styles.badge}>
                  {visibility === "public" ? (
                    <Globe2 size={10} aria-hidden="true" />
                  ) : (
                    <Lock size={10} aria-hidden="true" />
                  )}
                  {visibility === "public" ? "Accepting volunteers" : "Invitation only"}
                </span>
                <h2 className={styles.previewName}>{form.name.trim() || "Your organization"}</h2>
                <p className={styles.orgMeta}>
                  <MapPin size={10} aria-hidden="true" /> {form.city.trim() || "City"},{" "}
                  {form.state.trim() || "ST"}
                </p>
                <p className={styles.previewText}>
                  {form.description.trim() ||
                    "Two sentences about your work will show here, so volunteers know what they are signing up for."}
                </p>
                <p className={styles.previewText}>
                  {form.contactEmail.trim() || "contact@example.org"}
                </p>
              </div>
            </aside>
          </form>
        </div>
      </section>
    </main>
  );
}
