import { useState } from "react";
import { ArrowLeft, ArrowRight, Building2, KeyRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui";
import { accountHome, useAuth } from "../../lib/auth/session";
import { completeSetup } from "../../lib/onboarding/store";
import {
  redeemOrganizationInvite,
  selectOrganization,
  currentAccessFor,
} from "../../lib/organizations/store";
import { useOrganizationWorkspace } from "../../lib/organizations/useOrganizationWorkspace";
import styles from "./onboarding.module.css";
import { messageOf } from "../../lib/errors";

export function CoordinatorStartPage() {
  const navigate = useNavigate();
  const { user, signOut, refresh } = useAuth();
  const { organizations } = useOrganizationWorkspace(user);
  const [mode, setMode] = useState<"join" | "create">(organizations.length ? "create" : "join");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <main className={styles.screen}>
        <p className={styles.lede}>Sign in to create or join a coordinator workspace.</p>
      </main>
    );
  }

  async function submitInvite() {
    if (!user) return;
    setError("");
    const token = invite.trim();
    if (token.length < 16) {
      setError("Paste the full invitation from the workspace owner.");
      return;
    }
    setBusy(true);
    try {
      await redeemOrganizationInvite(user, token);
      completeSetup(user.email);
      // The workspace role comes from the membership just redeemed.
      await refresh();
      const access = currentAccessFor(user);
      navigate(
        access?.membership.role === "volunteer"
          ? "/volunteer/home"
          : "/coordinator/mission-control",
        { replace: true },
      );
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function open(organizationId: string) {
    if (!user) return;
    setBusy(true);
    try {
      await selectOrganization(user, organizationId);
      completeSetup(user.email);
      await refresh();
      navigate("/coordinator/mission-control");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
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

      <section className={styles.shell} aria-labelledby="coordinator-start-title">
        <header className={styles.head}>
          <p className={styles.eyebrow}>
            <Building2 size={13} aria-hidden="true" />
            {user.name}
          </p>
          <h1 className={styles.title} id="coordinator-start-title">
            Put your organization on the map.
          </h1>
          <p className={styles.lede}>
            Join a team that already uses CivicFlow with a one-time invitation, or start a new
            workspace and invite the rest of the team by email.
          </p>
        </header>

        <div className={styles.body}>
          {organizations.length > 0 ? (
            <section aria-labelledby="your-workspaces">
              <h2 className={styles.sectionTitle} id="your-workspaces">
                Your workspaces
              </h2>
              <p className={styles.sectionHint}>
                Open one, or add another organization below. You can switch at any time from the
                workspace menu.
              </p>
              <ul className={styles.orgList} style={{ marginTop: 12 }}>
                {organizations.map(({ organization, membership }) => (
                  <li className={styles.orgCard} key={organization.id} data-joined="true">
                    <img
                      className={styles.orgThumb}
                      src={organization.image}
                      alt={organization.imageAlt}
                    />
                    <div>
                      <h3 className={styles.orgName}>{organization.name}</h3>
                      <p className={styles.orgMeta}>
                        {organization.city}, {organization.state} · {membership.role}
                      </p>
                      <p className={styles.orgCopy}>{organization.description}</p>
                    </div>
                    <div className={styles.orgAction}>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => void open(organization.id)}
                      >
                        Open
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className={styles.choices}>
            <button
              type="button"
              className={styles.choice}
              data-selected={mode === "join"}
              aria-pressed={mode === "join"}
              onClick={() => {
                setMode("join");
                setError("");
              }}
            >
              <span className={styles.choiceIcon} aria-hidden="true">
                <KeyRound size={16} />
              </span>
              <span className={styles.choiceTitle}>Join an existing team</span>
              <span className={styles.choiceBody}>
                Redeem the one-time invitation the workspace owner sent you.
              </span>
            </button>

            <button
              type="button"
              className={styles.choice}
              data-selected={mode === "create"}
              aria-pressed={mode === "create"}
              onClick={() => {
                setMode("create");
                setError("");
              }}
            >
              <span className={styles.choiceIcon} aria-hidden="true">
                <Building2 size={16} />
              </span>
              <span className={styles.choiceTitle}>Start a new organization</span>
              <span className={styles.choiceBody}>
                Add your profile, address, contact email, and photo. You become its owner.
              </span>
            </button>
          </div>

          {mode === "join" ? (
            <div className={styles.panel}>
              <h2 className={styles.sectionTitle}>Invitation</h2>
              <label className={styles.codeLabel} htmlFor="coordinator-invite">
                Paste the invitation link or code
              </label>
              <div className={styles.codeRow}>
                <input
                  id="coordinator-invite"
                  className={styles.codeInput}
                  autoComplete="one-time-code"
                  placeholder="civicflow1_…"
                  value={invite}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "coordinator-invite-error" : undefined}
                  onChange={(event) => {
                    setInvite(event.target.value);
                    setError("");
                  }}
                />
                <Button
                  onClick={() => void submitInvite()}
                  disabled={busy}
                  icon={<ArrowRight size={14} />}
                >
                  {busy ? "Joining…" : "Join workspace"}
                </Button>
              </div>
              {error ? (
                <p className={styles.error} id="coordinator-invite-error" role="alert">
                  {error}
                </p>
              ) : null}
              <p className={styles.footerNote}>
                Invitations are one-time, expire after 14 days, and grant only the role they name.
                There is no reusable coordinator code.
              </p>
            </div>
          ) : (
            <div className={styles.panel}>
              <h2 className={styles.sectionTitle}>What happens next</h2>
              <ol className={styles.sectionHint} style={{ margin: 0, paddingLeft: 18 }}>
                <li>Add the organization details volunteers will see.</li>
                <li>Choose whether it is public or invitation-only.</li>
                <li>Invite coordinators and volunteers from Organization &amp; access.</li>
              </ol>
              <div className={styles.actions}>
                <Button
                  size="large"
                  icon={<ArrowRight size={15} />}
                  onClick={() => navigate("/coordinator/organization/new")}
                >
                  Create organization
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
