import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedAssignment, RosterEvaluation } from "../../types/domain";
import { SharedParticipationPage } from "./SharedParticipationPage";

const ORG = "11111111-1111-4111-8111-111111111111";
const SHIFT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const OPPORTUNITY = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const VOLUNTEER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

const { evaluate, apply } = vi.hoisted(() => ({
  evaluate: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("../../lib/sync/sharedRoster", () => ({
  evaluateSharedRoster: evaluate,
  SHARED_ROSTER_OPTIONS: {
    preferSpanish: false,
    blockConflicts: true,
    capWeekly: false,
    includeWaitlist: false,
  },
}));

vi.mock("../../lib/sync/writes", () => ({
  applySharedRosterPlan: apply,
  cancelSharedRegistration: vi.fn(),
  checkInShared: vi.fn(),
  checkOutShared: vi.fn(),
  markNoShowShared: vi.fn(),
  reviewSharedHours: vi.fn(),
}));

const assignment: PlannedAssignment = {
  shiftId: SHIFT,
  opportunityId: OPPORTUNITY,
  shiftTitle: "Pantry",
  role: "Greeter",
  candidateId: VOLUNTEER,
  candidateName: "Vera Volunteer",
  candidateInitials: "VV",
  startsAt: "2030-06-01T09:00:00.000Z",
  score: 90,
  breakdown: {
    skill: 35,
    availability: 25,
    interest: 15,
    preference: 6,
    fairness: 10,
    reliability: 5,
    total: 90,
  },
  reasons: ["Welcoming skill matched"],
  promoteWaitlist: false,
  eligibleRoles: ["Greeter"],
  explanation: {
    candidateId: VOLUNTEER,
    candidateName: "Vera Volunteer",
    candidateInitials: "VV",
    slotId: `${SHIFT}-Greeter-1`,
    shiftId: SHIFT,
    role: "Greeter",
    eligible: true,
    checks: [
      {
        name: "Required skill",
        passed: true,
        detail: "Welcoming on the profile",
      },
    ],
    components: [],
    totalScore: 90,
    selected: true,
    selectionReason: "Vera Volunteer matches the required Welcoming skill",
  },
};

const evaluation: RosterEvaluation = {
  generatedAt: "2030-05-01T00:00:00.000Z",
  policyVersion: 1,
  revision: 8,
  plan: {
    assignments: [assignment],
    unfilled: [],
    totalScore: 90,
    slotsConsidered: 1,
    candidatesConsidered: 1,
    deterministicSeed: 1,
    policyVersion: 1,
    generatedAt: "2030-05-01T00:00:00.000Z",
    revision: 8,
  },
  candidates: [],
};

vi.mock("../../lib/sync/sharedReplica", () => ({
  useSharedReplica: () => ({
    sync: {
      organizationId: ORG,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      membershipEpoch: 1,
      organizationName: "Rivergate Kitchen",
      phase: "ready",
      online: true,
      configured: true,
      cursor: 12,
      entities: 8,
      revision: 8,
      pending: 0,
      conflicts: 0,
      lastSyncedAt: null,
      error: null,
    },
    data: {
      organization: null,
      opportunities: [{ id: OPPORTUNITY, title: "Pantry" }],
      shifts: [
        {
          id: SHIFT,
          opportunity_id: OPPORTUNITY,
          starts_at: "2030-06-01T09:00:00.000Z",
          ends_at: "2030-06-01T12:00:00.000Z",
          capacity: 2,
          confirmed: 0,
          status: "scheduled",
        },
      ],
      shiftRoles: [],
      roleRequirements: [],
      volunteers: [
        {
          id: VOLUNTEER,
          name: "Vera Volunteer",
          status: "active",
        },
      ],
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
}));

beforeEach(() => {
  evaluate.mockReset();
  apply.mockReset();
  evaluate.mockResolvedValue(evaluation);
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

describe("shared participation planning", () => {
  it("asks the Rust solver and applies its revision-guarded plan", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SharedParticipationPage />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Quick plan" }));
    expect(await screen.findByText("Vera Volunteer")).toBeInTheDocument();
    expect(
      await screen.findByText("Vera Volunteer matches the required Welcoming skill"),
    ).toBeInTheDocument();
    expect(evaluate).toHaveBeenCalledWith(ORG, [SHIFT], expect.any(Object));

    await user.click(screen.getByRole("button", { name: "Apply 1 assignments" }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith(
        [{ shiftId: SHIFT, volunteerId: VOLUNTEER, role: "Greeter" }],
        8,
      ),
    );
  });
});
