import { useEffect, useMemo, useState } from "react";
import { Copy, Mail, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { Badge, Button, Card, Page, PageHeader, SearchField } from "../../components/ui";
import { useAuth } from "../../lib/auth/session";
import { initialsOf } from "../../lib/initials";
import { hydrateOrganizations } from "../../lib/organizations/store";
import { useOrganizationWorkspace } from "../../lib/organizations/useOrganizationWorkspace";
import { getWorkspaceRepository } from "../../lib/workspace/repository";
import type {
  IssuedInvite,
  OrganizationMember,
  PendingInvite,
} from "../../lib/organizations/types";
import { isCoordinatorRole, membershipRoleLabel } from "../../lib/organizations/types";
import styles from "./OrganizationAccessPage.module.css";

const repository = getWorkspaceRepository();

/** Preview memberships only store an address; show a readable name for them. */
function displayName(member: OrganizationMember): string {
  if (/\s/.test(member.name)) return member.name;
  return member.email
    .split("@")[0]
    .split(/[._-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function OrganizationAccessPage() {
  const { user } = useAuth();
  const { current, memberships } = useOrganizationWorkspace(user);
  const membership = memberships.find((row) => row.organizationId === current?.id);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"coordinator" | "volunteer">("volunteer");
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const organizationId = current?.id ?? "";
  const isOwner = membership?.role === "owner";
  const canManage = membership ? isCoordinatorRole(membership.role) : false;

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    void Promise.all([
      repository.listOrganizationMembers(organizationId),
      repository.listOrganizationInvites(organizationId),
    ])
      .then(([nextMembers, nextInvites]) => {
        if (!active) return;
        setMembers(nextMembers);
        setInvites(nextInvites);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((member) =>
      `${member.name} ${member.email} ${member.role}`.toLowerCase().includes(needle),
    );
  }, [members, query]);

  const openInvites = invites.filter((invite) => !invite.redeemedAt && !invite.revokedAt);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy("invite");
    setError("");
    setNotice("");
    setIssued(null);
    try {
      const created = await repository.createOrganizationInvite(organizationId, role, email);
      setIssued(created);
      setEmail("");
      setInvites(await repository.listOrganizationInvites(organizationId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function changeRole(member: OrganizationMember, next: "coordinator" | "volunteer") {
    setBusy(member.userId);
    setError("");
    setNotice("");
    try {
      setMembers(await repository.setOrganizationMemberRole(organizationId, member.userId, next));
      setNotice(`${displayName(member)} is now a ${next}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function disable(member: OrganizationMember) {
    setBusy(member.userId);
    setError("");
    setNotice("");
    try {
      setMembers(
        await repository.setOrganizationMemberStatus(organizationId, member.userId, "disabled"),
      );
      setNotice(`${displayName(member)} can no longer sign in to this organization.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function restore(member: OrganizationMember) {
    setBusy(member.userId);
    setError("");
    setNotice("");
    try {
      setMembers(
        await repository.setOrganizationMemberStatus(organizationId, member.userId, "active"),
      );
      setNotice(`${displayName(member)} can sign in again.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function makeOwner(member: OrganizationMember) {
    if (
      !window.confirm(
        `Make ${displayName(member)} an owner? They gain every membership permission, and you become a coordinator.`,
      )
    )
      return;
    setBusy(member.userId);
    setError("");
    setNotice("");
    try {
      setMembers(await repository.transferOrganizationOwnership(organizationId, member.userId));
      // The transfer demotes the signed-in owner too, and the badge in the
      // panel head reads that cached membership rather than this list.
      hydrateOrganizations(await repository.listOrganizations());
      setNotice(`${displayName(member)} is now an owner.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function revoke(invite: PendingInvite) {
    setBusy(invite.id);
    setError("");
    setNotice("");
    try {
      await repository.revokeOrganizationInvite(organizationId, invite.id);
      setInvites(await repository.listOrganizationInvites(organizationId));
      // The issued panel hands out a copyable code; leaving it up after the
      // invitation is revoked would keep offering a dead token.
      if (issued?.id === invite.id) setIssued(null);
      setNotice("Invitation revoked.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  if (!current || !membership) {
    return (
      <Page>
        <PageHeader title="Organization & access" description="Select a workspace first." />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow={current.name}
        title="Organization & access"
        description="Membership decides what someone can do. Invitations are one-time, expire, and grant only the role they name."
      />

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      <div className={styles.layout}>
        <Card className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Members</h2>
              <p className={styles.panelSub}>
                {members.filter((member) => member.status === "active").length} active ·{" "}
                {members.length} total
              </p>
            </div>
            <Badge tone={isOwner ? "violet" : "green"} icon={<ShieldCheck size={10} />}>
              You are {membershipRoleLabel(membership.role).toLowerCase()}
            </Badge>
          </div>

          <SearchField
            value={query}
            onChange={setQuery}
            label="Search members"
            placeholder="Search name, email, or role"
          />

          <ul className={styles.memberList}>
            {filtered.map((member) => {
              const self = member.userId === user?.id;
              const disabled = member.status === "disabled";
              const name = displayName(member);
              return (
                <li key={member.userId} className={styles.member} data-disabled={disabled}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initialsOf(name)}
                  </span>
                  <span className={styles.memberText}>
                    <span className={styles.memberName}>
                      {name}
                      {self ? <span className={styles.you}>You</span> : null}
                    </span>
                    <span className={styles.memberMeta}>
                      {member.email} · {membershipRoleLabel(member.role)}
                    </span>
                  </span>
                  <span className={styles.memberActions}>
                    {member.role === "owner" ? (
                      <Badge tone="violet">Owner</Badge>
                    ) : canManage ? (
                      <select
                        value={member.role}
                        aria-label={`Role for ${name}`}
                        disabled={busy === member.userId || !isOwner}
                        onChange={(event) =>
                          void changeRole(member, event.target.value as "coordinator" | "volunteer")
                        }
                      >
                        <option value="volunteer">Volunteer</option>
                        <option value="coordinator">Coordinator</option>
                      </select>
                    ) : null}
                    {isOwner && !self && member.status === "active" ? (
                      <button
                        type="button"
                        className={styles.iconButton}
                        title={`Remove ${name}`}
                        aria-label={`Remove ${name}`}
                        disabled={busy === member.userId}
                        onClick={() => void disable(member)}
                      >
                        <UserMinus size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                    {isOwner && !self && member.status === "disabled" ? (
                      <button
                        type="button"
                        className={styles.textButton}
                        disabled={busy === member.userId}
                        onClick={() => void restore(member)}
                      >
                        Restore
                      </button>
                    ) : null}
                    {isOwner && !self && member.status === "active" && member.role !== "owner" ? (
                      <button
                        type="button"
                        className={styles.textButton}
                        disabled={busy === member.userId}
                        onClick={() => void makeOwner(member)}
                      >
                        Make owner
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 ? (
            <p className={styles.empty}>No member matches that search.</p>
          ) : null}
        </Card>

        <div className={styles.side}>
          <Card className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Invite someone</h2>
                <p className={styles.panelSub}>One link for one person.</p>
              </div>
              <UserPlus size={16} aria-hidden="true" />
            </div>
            {canManage ? (
              <form className={styles.form} onSubmit={(event) => void invite(event)}>
                <label className={styles.field}>
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.org"
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Role</span>
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as "coordinator" | "volunteer")}
                  >
                    <option value="volunteer">Volunteer</option>
                    {isOwner ? <option value="coordinator">Coordinator</option> : null}
                  </select>
                </label>
                <Button type="submit" disabled={busy === "invite"} icon={<Mail size={14} />}>
                  {busy === "invite" ? "Creating…" : "Create invitation"}
                </Button>
              </form>
            ) : (
              <p className={styles.empty}>Only coordinators can invite people.</p>
            )}

            {issued ? (
              <div className={styles.issued} role="status">
                <p className={styles.issuedTitle}>Invitation for {issued.email}</p>
                <code className={styles.token}>{issued.token}</code>
                <div className={styles.issuedActions}>
                  <Button
                    variant="secondary"
                    size="small"
                    icon={<Copy size={13} />}
                    onClick={() => void navigator.clipboard?.writeText(issued.token)}
                  >
                    Copy code
                  </Button>
                  <span className={styles.expiry}>
                    Expires {new Date(issued.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                <p className={styles.hint}>
                  Send this code to {issued.email}. It can be redeemed once and only grants the role
                  shown above.
                </p>
              </div>
            ) : null}
          </Card>

          <Card className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Pending invitations</h2>
                <p className={styles.panelSub}>{openInvites.length} waiting</p>
              </div>
            </div>
            {openInvites.length === 0 ? (
              <p className={styles.empty}>No unused invitations.</p>
            ) : (
              <ul className={styles.inviteList}>
                {openInvites.map((invite) => (
                  <li key={invite.id} className={styles.invite}>
                    <span className={styles.memberText}>
                      <span className={styles.memberName}>{invite.email ?? "Open invitation"}</span>
                      <span className={styles.memberMeta}>
                        {membershipRoleLabel(invite.role)} · expires{" "}
                        {new Date(invite.expiresAt).toLocaleDateString()}
                      </span>
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className={styles.textButton}
                        disabled={busy === invite.id}
                        onClick={() => void revoke(invite)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <p className={styles.footNote}>
        Removing someone disables their membership here. Their local records stay on their device;
        the next shared write is rejected because their membership epoch is out of date.
      </p>
    </Page>
  );
}
