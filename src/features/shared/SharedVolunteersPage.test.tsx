import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SharedVolunteersPage } from "./SharedVolunteersPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const TYPE = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const CREDENTIAL = "99999999-9999-4999-8999-999999999999";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../lib/sync/desktop", () => ({
  startDesktopSync: vi.fn(async () => ({})),
  syncDesktopNow: vi.fn(async () => ({})),
  desktopSyncSnapshot: () => ({ organizationId: ORG, revision: 5, online: true, conflicts: 0 }),
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
        entities: 9,
        revision: 5,
        pending: 0,
        conflicts: 0,
        lastSyncedAt: null,
        error: null,
      },
      data: {
        organization: null,
        opportunities: [],
        shifts: [],
        shiftRoles: [],
        roleRequirements: [],
        volunteers: [
          {
            id: VOLUNTEER,
            name: "Vera Volunteer",
            role: "Volunteer",
            email: "vera@example.org",
            phone: "555-0101",
            status: "active",
            joined_at: "2026-01-04T12:00:00.000Z",
            hours_verified: 12.5,
            events_completed: 4,
            languages: ["English"],
            causes: ["Hunger"],
            interests: "Packing",
            row_version: 3,
          },
        ],
        volunteerSkills: [{ id: "skill-1", volunteer_id: VOLUNTEER, skill: "Packing" }],
        availabilityRules: [
          { id: "rule-1", volunteer_id: VOLUNTEER, day: "mon", period: "morning" },
        ],
        credentialTypes: [{ id: TYPE, name: "Food handler", validity_months: 24 }],
        credentials: [
          {
            id: CREDENTIAL,
            volunteer_id: VOLUNTEER,
            credential_type_id: TYPE,
            identifier: "FH-1",
            valid_through: "2030-01-01",
            verified_at: "2029-01-01T12:00:00.000Z",
            row_version: 1,
          },
        ],
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

beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  mock.mockReset();
  mock.mockResolvedValue(1);
});

function mount() {
  return render(
    <MemoryRouter>
      <SharedVolunteersPage />
    </MemoryRouter>,
  );
}

describe("shared volunteer records", () => {
  it("shows the directory, profile, skills, and credential state", async () => {
    mount();

    expect(await screen.findByRole("heading", { name: "Volunteers" })).toBeInTheDocument();
    expect(screen.getAllByText("Vera Volunteer").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Name")).toHaveValue("Vera Volunteer");
    expect(screen.getByRole("button", { name: "Remove Packing" })).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText(/valid through Jan 1, 2030/i)).toBeInTheDocument();
  });

  it("queues a profile edit with the version the form was built from", async () => {
    const user = userEvent.setup();
    mount();

    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Vera Volunteers");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "sync_enqueue_command",
        expect.objectContaining({
          command: "SAVE_VOLUNTEER_PROFILE",
          payload: expect.objectContaining({
            volunteerId: VOLUNTEER,
            name: "Vera Volunteers",
            status: "active",
          }),
          entityVersions: { [`volunteer:${VOLUNTEER}`]: 3 },
        }),
      ),
    );
  });

  it("adds a skill and a weekly slot, then saves each set", async () => {
    const user = userEvent.setup();
    mount();

    const skill = await screen.findByLabelText("Add a skill");
    await user.type(skill, "Driving");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Save skills" }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "sync_enqueue_command",
        expect.objectContaining({
          command: "SET_VOLUNTEER_SKILLS",
          payload: { volunteerId: VOLUNTEER, skills: ["Driving", "Packing"] },
        }),
      ),
    );

    const tuesday = screen.getByRole("button", { name: "Tuesday afternoon" });
    expect(tuesday).toHaveAttribute("aria-pressed", "false");
    await user.click(tuesday);
    expect(tuesday).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Save availability" }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "sync_enqueue_command",
        expect.objectContaining({
          command: "SET_VOLUNTEER_AVAILABILITY",
          payload: {
            volunteerId: VOLUNTEER,
            slots: expect.arrayContaining([
              { day: "mon", period: "morning" },
              { day: "tue", period: "afternoon" },
            ]),
          },
        }),
      ),
    );
  });

  it("opens a credential form with the organization's type and queues it", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole("button", { name: "Add credential" }));
    expect(screen.getByRole("heading", { name: "New credential" })).toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toHaveValue(TYPE);

    await user.type(screen.getByLabelText("Identifier"), "FH-500");
    await user.click(screen.getByRole("button", { name: "Save credential" }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "sync_enqueue_command",
        expect.objectContaining({
          command: "UPDATE_CREDENTIAL",
          payload: expect.objectContaining({
            volunteerId: VOLUNTEER,
            credentialTypeId: TYPE,
            identifier: "FH-500",
          }),
          entityVersions: {},
        }),
      ),
    );
  });
});
