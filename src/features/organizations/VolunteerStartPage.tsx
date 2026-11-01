import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Compass,
  KeyRound,
  MapPin,
  Users,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button, SearchField } from "../../components/ui";
import { accountHome, useAuth } from "../../lib/auth/session";
import { completeSetup } from "../../lib/onboarding/store";
import { ORGANIZATION_COVERS } from "../../lib/organizations/types";
import {
  currentAccessFor,
  joinOrganization,
  redeemOrganizationInvite,
  selectOrganization,
} from "../../lib/organizations/store";
import { useOrganizationWorkspace } from "../../lib/organizations/useOrganizationWorkspace";
import { getWorkspaceRepository } from "../../lib/workspace/repository";
import styles from "./onboarding.module.css";
import { messageOf } from "../../lib/errors";

export function VolunteerStartPage() {
  const repository = getWorkspaceRepository();
  const navigate = useNavigate();
  const { user, signOut, refresh } = useAuth();
  const { organizations, memberships, current } = useOrganizationWorkspace(user);
  const [publicOrganizations, setPublicOrganizations] = useState<
    Awaited<ReturnType<typeof repository.listPublicOrganizations>>
  >([]);
  const [query, setQuery] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    repository
      .listPublicOrganizations()
      .then((rows) => {
        if (active) setPublicOrganizations(rows);
      })
      .catch(() => {
        if (active) setPublicOrganizations([]);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) {
    return (
      <main className={styles.screen}>
        <p className={styles.lede}>Sign in to find an organization near you.</p>
      </main>
    );
  }

  const joined = new Set(memberships.map((membership) => membership.organizationId));
  const needle = query.trim().toLowerCase();
  const discoverable = publicOrganizations.filter((organization) => {
    if (organization.visibility !== "public") return false;
    if (joined.has(organization.id)) return false;
    if (!needle) return true;
    return [organization.name, organization.city, organization.state, organization.description]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  async function open(organizationId: string) {
    if (!user) return;
    setBusy(organizationId);
    try {
      await selectOrganization(user, organizationId);
      completeSetup(user.email);
      // The workspace role comes from the membership just selected, and the
      // route guard reads it from the session.
      await refresh();
      navigate("/volunteer/home", { replace: true });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  async function join(organizationId: string) {
    if (!user) return;
    setError("");
    setNotice("");
    setBusy(organizationId);
    try {
      const organization = await joinOrganization(user, organizationId);
      completeSetup(user.email);
      await refresh();
      setNotice(`You're in. ${organization.name} is now your current workspace.`);
      window.setTimeout(() => navigate("/volunteer/home"), 650);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  async function submitInvite() {
    if (!user) return;
    setError("");
    setNotice("");
    const token = invite.trim();
    if (token.length < 16) {
      setError("Paste the full invitation a coordinator sent you.");
      return;
    }
    setBusy("invite");
    try {
      const organization = await redeemOrganizationInvite(user, token);
      completeSetup(user.email);
      await refresh();
      const access = currentAccessFor(user);
      setNotice(`You're in. ${organization.name} is now your current workspace.`);
      window.setTimeout(
        () =>
          navigate(
            access?.membership.role === "volunteer"
              ? "/volunteer/home"
              : "/coordinator/mission-control",
          ),
        650,
      );
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  return (
    <main className={styles.screen}>
      <div className={styles.backRow}>
        {organizations.length > 0 ? (
          <Link className={styles.back} to={accountHome(user)}>
            <ArrowLeft size={14} aria-hidden="true" />
            Back to workspace
          </Link>
        ) : (
          <span />
        )}
        <button type="button" className={styles.signOut} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <section className={styles.shell} aria-labelledby="volunteer-start-title">
        <header className={styles.head}>
          <p className={styles.eyebrow}>
            <Compass size={13} aria-hidden="true" />
            {user.name}
          </p>
          <h1 className={styles.title} id="volunteer-start-title">
            Find a place to serve.
          </h1>
          <p className={styles.lede}>
            Join a public organization near you, or redeem the one-time invitation a coordinator
            sent. You can belong to more than one and switch between them.
          </p>
        </header>

        <div className={styles.body}>
          {organizations.length > 0 ? (
            <section aria-labelledby="joined-title">
              <h2 className={styles.sectionTitle} id="joined-title">
                Your organizations
              </h2>
              <ul className={styles.orgList} style={{ marginTop: 12 }}>
                {organizations.map(({ organization }) => (
                  <li className={styles.orgCard} key={organization.id} data-joined="true">
                    <img
                      className={styles.orgThumb}
                      src={organization.image}
                      alt={organization.imageAlt}
                    />
                    <div>
                      <h3 className={styles.orgName}>{organization.name}</h3>
                      <p className={styles.orgMeta}>
                        <MapPin size={10} aria-hidden="true" /> {organization.city},{" "}
                        {organization.state}
                      </p>
                      <p className={styles.orgCopy}>{organization.description}</p>
                    </div>
                    <div className={styles.orgAction}>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busy !== "" || current?.id === organization.id}
                        onClick={() => void open(organization.id)}
                      >
                        {current?.id === organization.id ? "Current" : "Switch"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className={styles.twoCol}>
            <section aria-labelledby="nearby-title">
              <h2 className={styles.sectionTitle} id="nearby-title">
                Organizations accepting volunteers
              </h2>
              <p className={styles.sectionHint}>
                Public workspaces on this device. Joining is immediate; a coordinator sees you on
                the roster.
              </p>
              <div style={{ margin: "12px 0 14px" }}>
                <SearchField
                  value={query}
                  onChange={setQuery}
                  label="Search organizations"
                  placeholder="Search by name or city…"
                />
              </div>
              {discoverable.length === 0 ? (
                <p className={styles.footerNote}>
                  {query.trim()
                    ? `Nothing matches “${query}”. Try a city, or redeem an invitation instead.`
                    : "No other organizations are open to volunteers right now. Redeem an invitation instead."}
                </p>
              ) : (
                <ul className={styles.orgList}>
                  {discoverable.map((organization) => (
                    <li className={styles.orgCard} key={organization.id} data-joined={false}>
                      <img
                        className={styles.orgThumb}
                        src={organization.image ?? ORGANIZATION_COVERS[0].src}
                        alt={organization.imageAlt ?? ORGANIZATION_COVERS[0].alt}
                      />
                      <div>
                        <h3 className={styles.orgName}>{organization.name}</h3>
                        <p className={styles.orgMeta}>
                          <MapPin size={10} aria-hidden="true" /> {organization.city},{" "}
                          {organization.state}
                        </p>
                        <p className={styles.orgCopy}>{organization.description}</p>
                        <p className={styles.orgMeta} style={{ marginTop: 8 }}>
                          <Users size={10} aria-hidden="true" /> Open to new volunteers
                        </p>
                      </div>
                      <div className={styles.orgAction}>
                        <Button
                          size="small"
                          icon={<ArrowRight size={13} />}
                          disabled={busy !== ""}
                          onClick={() => void join(organization.id)}
                        >
                          {busy === organization.id ? "Joining…" : "Join"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className={styles.panel} style={{ alignSelf: "start" }}>
              <h2 className={styles.sectionTitle}>
                <KeyRound size={14} aria-hidden="true" /> Have an invitation?
              </h2>
              <p className={styles.sectionHint}>
                One-time, expires after 14 days, and grants only the role it names. It also opens
                private organizations.
              </p>
              <label className={styles.codeLabel} htmlFor="volunteer-invite">
                Invitation link or code
              </label>
              <input
                id="volunteer-invite"
                className={styles.codeInput}
                autoComplete="one-time-code"
                placeholder="civicflow1_…"
                value={invite}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "volunteer-invite-error" : undefined}
                onChange={(event) => {
                  setInvite(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitInvite();
                }}
              />
              <Button onClick={() => void submitInvite()} disabled={busy !== ""}>
                {busy === "invite" ? "Joining…" : "Redeem invitation"}
              </Button>
              {error ? (
                <p className={styles.error} id="volunteer-invite-error" role="alert">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p
                  className={styles.footerNote}
                  role="status"
                  style={{ color: "var(--tone-green-ink)" }}
                >
                  <Check size={12} aria-hidden="true" /> {notice}
                </p>
              ) : null}
              <p className={styles.footerNote}>
                Invitations resolve against the workspace database on this device. A synced
                organization would validate them on the server.
              </p>
            </div>
          </div>

          {/* A new account starts here, and an empty device has no organization
              to join. Without this the only ways forward are an invite or a
              public workspace someone else already created. */}
          <section
            className={styles.panel}
            aria-labelledby="start-organization-title"
            style={{ marginTop: 18 }}
          >
            <h2 className={styles.sectionTitle} id="start-organization-title">
              <Building2 size={14} aria-hidden="true" /> Create an organization
            </h2>
            <p className={styles.sectionHint}>
              Join or create an organization to start scheduling.
            </p>
            <Link className={styles.back} to="/coordinator/start">
              Continue <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </section>
        </div>
      </section>
    </main>
  );
}
