import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMAND_TYPES,
  SYNC_CONTRACT_VERSION,
  type CommandFixture,
  type CommandType,
} from "./protocol";

/**
 * The fixtures are the contract. The Rust crate deserializes the same files, so
 * a field that drifts on one side fails here and in `cargo test sync` rather
 * than after a device has already queued an unreadable command.
 */
const FIXTURES = [
  "register-shift",
  "update-shift",
  "stale-plan",
  "attendance",
  "membership-revoked",
  "capacity-race",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function load(name: (typeof FIXTURES)[number]): CommandFixture {
  const path = resolve(process.cwd(), "shared", "sync-contract", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as CommandFixture;
}

describe("shared sync contract", () => {
  it("is at the version the clients expect", () => {
    expect(SYNC_CONTRACT_VERSION).toBe(1);
  });

  it.each(FIXTURES)("parses %s with every mandatory field", (name) => {
    const fixture = load(name);
    const envelope = fixture.envelope;

    expect(fixture.scenario.length).toBeGreaterThan(20);
    expect(envelope.operationId).toMatch(UUID);
    expect(envelope.replicaId).toMatch(UUID);
    expect(envelope.userId).toMatch(UUID);
    expect(envelope.organizationId).toMatch(UUID);
    expect(COMMAND_TYPES).toContain(envelope.command);
    expect(Number.isInteger(envelope.membershipEpoch)).toBe(true);
    expect(envelope.membershipEpoch).toBeGreaterThan(0);
    expect(Number.isInteger(envelope.baseWorkspaceRevision)).toBe(true);
    expect(envelope.baseWorkspaceRevision).toBeGreaterThanOrEqual(0);
    expect(new Date(envelope.clientCreatedAt).toISOString()).toBe(envelope.clientCreatedAt);
    expect(typeof envelope.payload).toBe("object");
    expect(Array.isArray(envelope.payload)).toBe(false);

    for (const [key, version] of Object.entries(envelope.entityVersions)) {
      expect(key).toContain(":");
      expect(Number.isInteger(version)).toBe(true);
      expect(version).toBeGreaterThan(0);
    }
  });

  it("binds the payload membership epoch to the envelope", () => {
    for (const name of FIXTURES) {
      const { envelope } = load(name);
      expect(envelope.payload.membershipEpoch).toBe(envelope.membershipEpoch);
    }
  });

  it("gives every scenario its own operation id", () => {
    const ids = FIXTURES.map((name) => load(name).envelope.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the command families the next phases migrate", () => {
    const commands = new Set<CommandType>(FIXTURES.map((name) => load(name).envelope.command));
    expect(commands).toEqual(
      new Set<CommandType>([
        "REGISTER_FOR_SHIFT",
        "UPDATE_SHIFT",
        "APPLY_ROSTER_PLAN",
        "CHECK_IN",
        "UPDATE_OPPORTUNITY",
      ]),
    );
  });
});
