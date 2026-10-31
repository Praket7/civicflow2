/**
 * Mirrors the organization contract over localStorage for the browser preview.
 * Fixture-only; the Tauri build never uses it as the authority.
 */

import type { Account } from "../../types/domain";
import { demoWorkspace } from "../workspace/dataset";
import type {
  IssuedInvite,
  NewOrganizationInput,
  OrganizationAccess,
  OrganizationDetailsPatch,
  OrganizationMember,
  OrganizationProfile,
  PendingInvite,
  OrganizationUpdate,
} from "./types";
import { ORGANIZATION_COVERS } from "./types";

const KEY = "civicflow.organizations.v2";
const MEMBERSHIPS_KEY = "civicflow.organizations.memberships.v2";
const CURRENT_KEY = "civicflow.organizations.current.v2";
const INVITES_KEY = "civicflow.organizations.invites.v2";
const UPDATES_KEY = "civicflow.organization-updates.v2";
const READ_KEY = "civicflow.organization-updates-read.v2";

const DEMO_ORG = "org-rivergate-kitchen";
const GARDEN_ORG = "org-riverside-garden";

type StoredOrganization = OrganizationProfile;

interface StoredMembership {
  organizationId: string;
  email: string;
  userId: string;
  role: OrganizationMember["role"];
  status: OrganizationMember["status"];
  joinedAt: string;
  membershipEpoch: number;
}

interface PreviewState {
  organizations: StoredOrganization[];
  memberships: StoredMembership[];
  current: Record<string, string>;
  invites: PendingInviteWithToken[];
  updates: OrganizationUpdate[];
  readAt: Record<string, string>;
}

interface PendingInviteWithToken extends PendingInvite {
  token: string;
  email: string;
}

let cached: PreviewState | null = null;

function demoOrganization(): StoredOrganization {
  return {
    id: DEMO_ORG,
    name: demoWorkspace.organization.name,
    initials: demoWorkspace.organization.initials,
    mission: demoWorkspace.organization.mission,
    description: demoWorkspace.organization.mission,
    city: demoWorkspace.organization.city,
    state: demoWorkspace.organization.state,
    address: demoWorkspace.organization.address,
    website: demoWorkspace.organization.website,
    email: demoWorkspace.organization.email,
    timezone: demoWorkspace.organization.timezone,
    visibility: "public",
    image: ORGANIZATION_COVERS[0].src,
    imageAlt: ORGANIZATION_COVERS[0].alt,
    createdAt: demoWorkspace.now,
    createdByUserId: "user-praket",
    isDemo: true,
    syncMode: "local",
  };
}

function gardenOrganization(): StoredOrganization {
  return {
    id: GARDEN_ORG,
    name: "Riverside Community Garden",
    initials: "RC",
    mission: "Neighbours grow vegetables together and share the surplus.",
    description:
      "Neighbours grow vegetables together on a shared plot and send the surplus to the food pantry two blocks away.",
    city: "Buffalo",
    state: "NY",
    address: "218 Riverside Avenue",
    website: "riversidegarden.example.org",
    email: "hello@riversidegarden.example.org",
    timezone: "America/New_York",
    visibility: "public",
    image: ORGANIZATION_COVERS[2].src,
    imageAlt: ORGANIZATION_COVERS[2].alt,
    createdAt: demoWorkspace.now,
    createdByUserId: null,
    isDemo: true,
    syncMode: "local",
  };
}

function seededMemberships(): StoredMembership[] {
  return [
    {
      organizationId: DEMO_ORG,
      email: demoWorkspace.coordinator.email.toLowerCase(),
      userId: "user-praket",
      role: "owner",
      status: "active",
      joinedAt: demoWorkspace.now,
      membershipEpoch: 1,
    },
    {
      organizationId: DEMO_ORG,
      email: (demoWorkspace.volunteers[0]?.email ?? "maya.chen@example.org").toLowerCase(),
      userId: "user-maya",
      role: "volunteer",
      status: "active",
      joinedAt: demoWorkspace.volunteers[0]?.joinedAt ?? demoWorkspace.now,
      membershipEpoch: 1,
    },
  ];
}

function emptyState(): PreviewState {
  return {
    organizations: [demoOrganization(), gardenOrganization()],
    memberships: seededMemberships(),
    current: {},
    invites: [],
    updates: [],
    readAt: {},
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory copy still serves the screen.
  }
}

function state(): PreviewState {
  if (cached) return cached;
  const base = emptyState();
  const organizations = readJson<StoredOrganization[]>(KEY, []);
  const missing = base.organizations.filter(
    (row) => !organizations.some((org) => org.id === row.id),
  );
  const memberships = readJson<StoredMembership[]>(MEMBERSHIPS_KEY, []);
  const missingMemberships = base.memberships.filter(
    (row) =>
      !memberships.some((m) => m.organizationId === row.organizationId && m.email === row.email),
  );
  cached = {
    organizations: [...organizations, ...missing],
    memberships: [...memberships, ...missingMemberships],
    current: readJson(CURRENT_KEY, {}),
    invites: readJson(INVITES_KEY, []),
    updates: readJson(UPDATES_KEY, []),
    readAt: readJson(READ_KEY, {}),
  };
  return cached;
}

function commit(next: PreviewState): void {
  cached = next;
  writeJson(KEY, next.organizations);
  writeJson(MEMBERSHIPS_KEY, next.memberships);
  writeJson(CURRENT_KEY, next.current);
  writeJson(INVITES_KEY, next.invites);
  writeJson(UPDATES_KEY, next.updates);
  writeJson(READ_KEY, next.readAt);
}

function memberCount(next: PreviewState, organizationId: string): number {
  return next.memberships.filter(
    (row) => row.organizationId === organizationId && row.status === "active",
  ).length;
}

function accessFor(
  next: PreviewState,
  organization: StoredOrganization,
  membership: StoredMembership,
): OrganizationAccess {
  return {
    organization,
    membership: {
      organizationId: membership.organizationId,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.joinedAt,
      membershipEpoch: membership.membershipEpoch,
    },
    members: memberCount(next, organization.id),
  };
}

export function list(account: Account): OrganizationAccess[] {
  const next = state();
  return next.memberships
    .filter((row) => row.email === account.email.toLowerCase())
    .map((membership) => {
      const organization = next.organizations.find((row) => row.id === membership.organizationId);
      return organization ? accessFor(next, organization, membership) : null;
    })
    .filter((row): row is OrganizationAccess => row !== null);
}

export function active(account: Account): OrganizationAccess | null {
  const listForAccount = list(account);
  if (listForAccount.length === 0) return null;
  const selected = state().current[account.email.toLowerCase()];
  return listForAccount.find((row) => row.organization.id === selected) ?? listForAccount[0];
}

export function select(account: Account, organizationId: string): OrganizationAccess {
  const access = list(account).find((row) => row.organization.id === organizationId);
  if (!access) throw new Error("That organization is not on this device.");
  commit({
    ...state(),
    current: { ...state().current, [account.email.toLowerCase()]: organizationId },
  });
  return access;
}

export function listPublic(): OrganizationProfile[] {
  return state().organizations.filter((organization) => organization.visibility === "public");
}

/// The owner of the first organization on this device opened the installation.
export function isWorkspaceSteward(account: Account): boolean {
  const next = state();
  const founding = [...next.organizations].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )[0];
  if (!founding) return false;
  return next.memberships.some(
    (row) =>
      row.organizationId === founding.id &&
      row.userId === account.id &&
      row.status === "active" &&
      row.role === "owner",
  );
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "organization";
}

export function create(account: Account, input: NewOrganizationInput): OrganizationAccess {
  const next = state();
  const base = `org-${slug(input.name)}`;
  let id = base;
  let suffix = 2;
  while (next.organizations.some((organization) => organization.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  const now = new Date().toISOString();
  const organization: StoredOrganization = {
    id,
    name: input.name.trim(),
    initials:
      input.name
        .split(/\s+/)
        .map((word) => word.charAt(0))
        .join("")
        .slice(0, 2)
        .toUpperCase() || "CF",
    mission: input.description.trim(),
    description: input.description.trim(),
    city: input.city.trim(),
    state: input.state.trim().toUpperCase(),
    address: input.address.trim(),
    website: input.website.trim(),
    email: input.contactEmails[0]?.trim().toLowerCase() ?? account.email,
    timezone: "America/New_York",
    visibility: input.visibility,
    image: input.image ?? ORGANIZATION_COVERS[0].src,
    imageAlt: input.imageAlt ?? ORGANIZATION_COVERS[0].alt,
    createdAt: now,
    createdByUserId: account.id,
    isDemo: false,
    syncMode: "local",
  };
  const membership: StoredMembership = {
    organizationId: id,
    email: account.email.toLowerCase(),
    userId: account.id,
    role: "owner",
    status: "active",
    joinedAt: now,
    membershipEpoch: 1,
  };
  const nextState: PreviewState = {
    ...next,
    organizations: [organization, ...next.organizations],
    memberships: [
      membership,
      ...next.memberships.filter(
        (row) => !(row.organizationId === id && row.email === membership.email),
      ),
    ],
    current: { ...next.current, [account.email.toLowerCase()]: id },
  };
  commit(nextState);
  return accessFor(nextState, organization, membership);
}

export function update(
  account: Account,
  organizationId: string,
  patch: OrganizationDetailsPatch,
): OrganizationProfile {
  const access = list(account).find((row) => row.organization.id === organizationId);
  if (!access || (access.membership.role !== "owner" && access.membership.role !== "coordinator")) {
    throw new Error("Only a coordinator can update that organization.");
  }
  const next = state();
  const updated = next.organizations.map((organization) =>
    organization.id === organizationId
      ? {
          ...organization,
          ...patch,
          name: patch.name?.trim() || organization.name,
          description: patch.description?.trim() ?? organization.description,
          mission: patch.description?.trim() ?? organization.mission,
          state: patch.state?.trim().toUpperCase() ?? organization.state,
          image: patch.image === undefined ? organization.image : patch.image,
          imageAlt: patch.imageAlt === undefined ? organization.imageAlt : patch.imageAlt,
        }
      : organization,
  );
  commit({ ...next, organizations: updated });
  return updated.find((organization) => organization.id === organizationId)!;
}

export function members(account: Account, organizationId: string): OrganizationMember[] {
  const access = list(account).find((row) => row.organization.id === organizationId);
  if (!access || (access.membership.role !== "owner" && access.membership.role !== "coordinator")) {
    throw new Error("Only a coordinator can read the member list.");
  }
  const next = state();
  return next.memberships
    .filter((row) => row.organizationId === organizationId)
    .map((row) => ({
      userId: row.userId,
      name: row.email.split("@")[0] ?? row.email,
      email: row.email,
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt,
    }));
}

function requireOwner(account: Account, organizationId: string): OrganizationAccess {
  const access = list(account).find((row) => row.organization.id === organizationId);
  if (!access || access.membership.role !== "owner") {
    throw new Error("Only an organization owner can do that.");
  }
  return access;
}

export function createInvite(
  account: Account,
  organizationId: string,
  role: "coordinator" | "volunteer",
  email: string,
): IssuedInvite {
  const access = list(account).find((row) => row.organization.id === organizationId);
  if (!access) throw new Error("You do not have access to that organization.");
  if (role === "coordinator" && access.membership.role !== "owner") {
    throw new Error("Only an organization owner can invite another coordinator.");
  }
  if (role === "volunteer" && access.membership.role === "volunteer") {
    throw new Error("Only a coordinator can invite a volunteer.");
  }
  const now = new Date();
  const invite: PendingInviteWithToken = {
    id: `invite-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    organizationId,
    role,
    email: email.trim().toLowerCase(),
    token: Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
    redeemedAt: null,
    revokedAt: null,
  };
  commit({ ...state(), invites: [invite, ...state().invites] });
  return {
    id: invite.id,
    organizationId,
    role,
    email: invite.email,
    token: invite.token,
    expiresAt: invite.expiresAt,
  };
}

export function invites(account: Account, organizationId: string): PendingInvite[] {
  const access = list(account).find((row) => row.organization.id === organizationId);
  if (!access || (access.membership.role !== "owner" && access.membership.role !== "coordinator")) {
    throw new Error("Only a coordinator can read invitations.");
  }
  return state()
    .invites.filter((invite) => invite.organizationId === organizationId)
    .map(({ token: _token, ...invite }) => invite);
}

export function revokeInvite(account: Account, organizationId: string, inviteId: string): void {
  const access = list(account).find((row) => row.organization.id === organizationId);
  if (!access || (access.membership.role !== "owner" && access.membership.role !== "coordinator")) {
    throw new Error("Only a coordinator can revoke an invitation.");
  }
  commit({
    ...state(),
    invites: state().invites.map((invite) =>
      invite.id === inviteId && invite.organizationId === organizationId
        ? { ...invite, revokedAt: new Date().toISOString() }
        : invite,
    ),
  });
}

export function redeem(account: Account, token: string): OrganizationAccess {
  const next = state();
  const invite = next.invites.find((row) => row.token === token.trim());
  if (
    !invite ||
    invite.revokedAt ||
    invite.redeemedAt ||
    invite.expiresAt <= new Date().toISOString()
  ) {
    throw new Error(
      "That invitation code is not valid. Check it with the coordinator who sent it.",
    );
  }
  if (invite.email && invite.email !== account.email.toLowerCase()) {
    throw new Error("That invitation was sent to a different email address.");
  }
  const existing = next.memberships.find(
    (row) =>
      row.organizationId === invite.organizationId && row.email === account.email.toLowerCase(),
  );
  if (existing?.status === "disabled") {
    throw new Error("Your access to that organization is disabled.");
  }
  const now = new Date().toISOString();
  const membership: StoredMembership = existing
    ? {
        ...existing,
        role: invite.role,
        status: "active",
        membershipEpoch: existing.membershipEpoch + 1,
      }
    : {
        organizationId: invite.organizationId,
        email: account.email.toLowerCase(),
        userId: account.id,
        role: invite.role,
        status: "active",
        joinedAt: now,
        membershipEpoch: 1,
      };
  const nextState: PreviewState = {
    ...next,
    memberships: [membership, ...next.memberships.filter((row) => row !== existing)],
    invites: next.invites.map((row) => (row.id === invite.id ? { ...row, redeemedAt: now } : row)),
    current: { ...next.current, [account.email.toLowerCase()]: invite.organizationId },
  };
  commit(nextState);
  const organization = nextState.organizations.find((row) => row.id === invite.organizationId)!;
  return accessFor(nextState, organization, membership);
}

export function join(account: Account, organizationId: string): OrganizationAccess {
  const next = state();
  const organization = next.organizations.find((row) => row.id === organizationId);
  if (!organization) throw new Error("That organization is not on this device.");
  if (organization.visibility !== "public") {
    throw new Error("That organization is private. A coordinator has to invite you.");
  }
  const existing = next.memberships.find(
    (row) => row.organizationId === organizationId && row.email === account.email.toLowerCase(),
  );
  if (existing) {
    if (existing.status === "disabled")
      throw new Error("Your access to that organization is disabled.");
    return select(account, organizationId);
  }
  const membership: StoredMembership = {
    organizationId,
    email: account.email.toLowerCase(),
    userId: account.id,
    role: "volunteer",
    status: "active",
    joinedAt: new Date().toISOString(),
    membershipEpoch: 1,
  };
  const nextState: PreviewState = {
    ...next,
    memberships: [membership, ...next.memberships],
    current: { ...next.current, [account.email.toLowerCase()]: organizationId },
  };
  commit(nextState);
  return accessFor(nextState, organization, membership);
}

export function setRole(
  account: Account,
  organizationId: string,
  userId: string,
  role: "coordinator" | "volunteer",
): OrganizationMember[] {
  requireOwner(account, organizationId);
  if (userId === account.id)
    throw new Error("You cannot change your own role. Transfer ownership first.");
  commit({
    ...state(),
    memberships: state().memberships.map((row) =>
      row.organizationId === organizationId && row.userId === userId
        ? { ...row, role, membershipEpoch: row.membershipEpoch + 1 }
        : row,
    ),
  });
  return members(account, organizationId);
}

export function setStatus(
  account: Account,
  organizationId: string,
  userId: string,
  status: "active" | "disabled",
): OrganizationMember[] {
  requireOwner(account, organizationId);
  if (userId === account.id) throw new Error("You cannot disable your own access.");
  commit({
    ...state(),
    memberships: state().memberships.map((row) =>
      row.organizationId === organizationId && row.userId === userId
        ? { ...row, status, membershipEpoch: row.membershipEpoch + 1 }
        : row,
    ),
  });
  return members(account, organizationId);
}

export function transferOwnership(
  account: Account,
  organizationId: string,
  userId: string,
): OrganizationMember[] {
  requireOwner(account, organizationId);
  const next = state();
  const target = next.memberships.find(
    (row) => row.organizationId === organizationId && row.userId === userId,
  );
  if (!target || target.status !== "active")
    throw new Error("Only an active member can become the owner.");
  commit({
    ...next,
    memberships: next.memberships.map((row) => {
      if (row.organizationId !== organizationId) return row;
      if (row.userId === userId)
        return { ...row, role: "owner", membershipEpoch: row.membershipEpoch + 1 };
      if (row.userId === account.id)
        return { ...row, role: "coordinator", membershipEpoch: row.membershipEpoch + 1 };
      return row;
    }),
  });
  return members(account, organizationId);
}

export function updatesFor(account: Account): OrganizationUpdate[] {
  const joined = new Set(list(account).map((row) => row.organization.id));
  return state().updates.filter((update) => joined.has(update.organizationId));
}

export function unreadUpdatesFor(account: Account): OrganizationUpdate[] {
  const since = state().readAt[account.email.toLowerCase()];
  return updatesFor(account).filter((update) => !since || update.createdAt > since);
}

export function markUpdatesRead(account: Account): void {
  const latest = updatesFor(account)[0]?.createdAt ?? new Date().toISOString();
  commit({ ...state(), readAt: { ...state().readAt, [account.email.toLowerCase()]: latest } });
}
