import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SharedConflictsPage } from "./SharedConflictsPage";
import type { SharedConflict } from "../../lib/sync/writes";

const ORG = "11111111-1111-4111-8111-111111111111";
const SHIFT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

let conflicts: SharedConflict[] = [];
const resolved: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../lib/sync/desktop", () => ({
  startDesktopSync: vi.fn(async () => ({})),
  syncDesktopNow: vi.fn(async () => ({})),
  desktopSyncSnapshot: () => ({
    organizationId: ORG,
    revision: 8,
    online: true,
    conflicts: conflicts.filter((conflict) => conflict.status === "open").length,
  }),
}));
vi.mock("../../lib/sync/sharedReplica", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/sync/sharedReplica")>();
  return {
    ...actual,
    useSharedReplica: () => ({
      sync: {
        organizationId: ORG,
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        membershipEpoch: 1,
        organizationName: "Rivergate Kitchen",
        phase: "ready",
        online: true,
        configured: true,
        cursor: 12,
        entities: 8,
        revision: 8,
        pending: 0,
        conflicts: conflicts.filter((conflict) => conflict.status === "open").length,
        lastSyncedAt: null,
        error: null,
      },
      data: {
        organization: null,
        opportunities: [],
        shifts: [],
        shiftRoles: [],
        roleRequirements: [],
        volunteers: [],
        volunteerSkills: [],
        availabilityRules: [],
        credentialTypes: [],
        credentials: [],
        registrations: [],
        waitlists: [],
        attendance: [],
        hourEntries: [],
        series: [],
        seriesRoles: [],
      },
      loading: false,
      error: null,
      reload: vi.fn(async () => {}),
      rebuild: vi.fn(async () => {}),
    }),
  };
});

const mock = vi.mocked(invoke);

function openConflict(): SharedConflict {
  return {
    id: "conflict-1",
    operationId: "99999999-9999-4999-8999-999999999999",
    command: "UPDATE_SHIFT",
    entityType: "shift",
    entityId: SHIFT,
    code: "row_version_conflict",
    message: "This record changed elsewhere (server version 2, you had 1).",
    localPayload: { capacity: 5, rowVersion: 1 },
    authoritative: { capacity: 10, rowVersion: 2 },
    classification: "field",
    status: "open",
    createdAt: "2026-10-31T12:00:00.000Z",
    resolvedAt: null,
  };
}

beforeEach(() => {
  resolved.length = 0;
  conflicts = [openConflict()];
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  mock.mockReset();
  mock.mockImplementation(async (command: string, rawArgs?: unknown) => {
    const args = rawArgs as Record<string, unknown> | undefined;
    if (command === "sync_list_conflicts") return structuredClone(conflicts);
    if (command === "sync_resolve_conflict") {
      resolved.push(String(args?.conflictId));
      conflicts = conflicts.map((conflict) =>
        conflict.id === args?.conflictId
          ? {
              ...conflict,
              status: args?.resolution === "resolved" ? "resolved" : "dismissed",
              resolvedAt: "2026-10-31T12:01:00.000Z",
            }
          : conflict,
      );
      return undefined;
    }
    return undefined;
  });
});

describe("two devices, one shift", () => {
  it("shows the losing edit beside the organization's current value", async () => {
    render(
      <MemoryRouter>
        <SharedConflictsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("This device sent")).toBeInTheDocument());
    expect(screen.getByText("Organization now")).toBeInTheDocument();
    expect(screen.getByText(/"capacity": 5/)).toBeInTheDocument();
    expect(screen.getByText(/"capacity": 10/)).toBeInTheDocument();
    expect(screen.getByText(/server version 2, you had 1/)).toBeInTheDocument();
    expect(screen.getByText("row version conflict")).toBeInTheDocument();
  });

  it("closing with the server value keeps the organization untouched", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SharedConflictsPage />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Keep server" }));

    await waitFor(() => expect(resolved).toEqual(["conflict-1"]));
    expect(mock).toHaveBeenCalledWith("sync_resolve_conflict", {
      organizationId: ORG,
      conflictId: "conflict-1",
      resolution: "resolved",
    });
    expect(await screen.findByText("Closed (1)")).toBeInTheDocument();
  });

  it("a device that never saw the race has an empty conflict log", async () => {
    conflicts = [];
    render(
      <MemoryRouter>
        <SharedConflictsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No sync issues")).toBeInTheDocument();
    expect(screen.queryByText("This device sent")).not.toBeInTheDocument();
  });
});
