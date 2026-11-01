/**
 * The wire protocol. These names mirror the SQL functions exactly; a client
 * that invents its own status strings cannot tell a retry from a revocation.
 */

export type CommandStatus =
  | "applied"
  | "already_applied"
  | "conflict"
  | "validation_error"
  | "forbidden"
  | "stale_authority"
  | "stale_plan"
  | "retryable_error";

export const COMMAND_TYPES = [
  "CREATE_OPPORTUNITY",
  "UPDATE_OPPORTUNITY",
  "CREATE_SHIFT",
  "CREATE_SHIFT_SERIES",
  "UPDATE_SHIFT",
  "REGISTER_FOR_SHIFT",
  "CANCEL_REGISTRATION",
  "JOIN_WAITLIST",
  "CHECK_IN",
  "CHECK_OUT",
  "MARK_NO_SHOW",
  "SAVE_VOLUNTEER_PROFILE",
  "SET_VOLUNTEER_SKILLS",
  "SET_VOLUNTEER_AVAILABILITY",
  "CREATE_CREDENTIAL_TYPE",
  "UPDATE_CREDENTIAL",
  "REVIEW_HOURS",
  "UPDATE_ROSTER_POLICY",
  "APPLY_ROSTER_PLAN",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

/**
 * The bytes every client agrees on. `userId` and `membershipEpoch` travel in
 * the envelope as well as the payload so a queued command is bound to the
 * person and authority it was created under even before it reaches a server.
 * The server still derives identity from the authenticated request; the copy
 * here is evidence, not a claim it trusts.
 */
export interface CommandEnvelope {
  operationId: string;
  replicaId: string;
  userId: string;
  organizationId: string;
  command: CommandType;
  membershipEpoch: number;
  baseWorkspaceRevision: number;
  entityVersions: Record<string, number>;
  payload: Record<string, unknown>;
  clientCreatedAt: string;
}

/** A named scenario plus the exact envelope both implementations deserialize. */
export interface CommandFixture {
  scenario: string;
  envelope: CommandEnvelope;
}

/** Bumped only when a fixture's meaning changes, not when a command is added. */
export const SYNC_CONTRACT_VERSION = 1;

/**
 * A membership epoch travels inside the payload because that is where the
 * server looks for it. Keeping it out of `payload` would let a revoked device
 * pass the epoch check with a null claim.
 */
export function withMembershipEpoch(
  envelope: CommandEnvelope,
  membershipEpoch: number,
): CommandEnvelope {
  return {
    ...envelope,
    membershipEpoch,
    payload: { ...envelope.payload, membershipEpoch },
  };
}

export interface CommandResult {
  status: CommandStatus;
  code?: string;
  message?: string;
  operationId?: string;
  command?: string;
  serverRevision?: number;
  cursor?: number;
  serverTime?: string;
  authoritative?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Change {
  sequence: number;
  entity: string;
  id: string;
  operation: "insert" | "update" | "delete";
  rowVersion?: number;
  payload?: Record<string, unknown>;
}

export interface PullResult {
  status: "ok" | "forbidden";
  cursor: number;
  hasMore: boolean;
  revision: number;
  changes: Change[];
}

/** Outcomes that will never succeed if the same bytes are sent again. */
export function isTerminalRefusal(status: CommandStatus): boolean {
  return (
    status === "conflict" ||
    status === "validation_error" ||
    status === "forbidden" ||
    status === "stale_authority" ||
    status === "stale_plan"
  );
}

/** Outcomes that mean the server did the work, or already had. */
export function isAccepted(status: CommandStatus): boolean {
  return status === "applied" || status === "already_applied";
}

export function isRetryable(status: CommandStatus): boolean {
  return status === "retryable_error";
}
