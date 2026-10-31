import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoWorkspace } from "../../types/domain";
import { publishLocalSchedule } from "./publish";
import { createSharedOpportunity, createSharedShift } from "./writes";
import { readReplicaEntities } from "./desktopStore";
import { startDesktopSync, syncDesktopNow } from "./desktop";
import { writeWorkspace } from "./db";

vi.mock("./db", () => ({ writeWorkspace: vi.fn(async () => {}) }));
vi.mock("./desktop", () => ({
  writeWorkspace: vi.fn(),
  startDesktopSync: vi.fn(async () => ({})),
  syncDesktopNow: vi.fn(async () => ({})),
  desktopSyncSnapshot: () => ({
    organizationId: "11111111-1111-4111-8111-111111111111",
    online: true,
  }),
}));
vi.mock("./desktopStore", () => ({ readReplicaEntities: vi.fn(async () => []) }));
vi.mock("./writes", () => ({
  createSharedOpportunity: vi.fn(async () => "new"),
  createSharedShift: vi.fn(async () => "new"),
}));

const orgId = "11111111-1111-4111-8111-111111111111";
const local = {
  opportunities: [
    {
      id: "opp-food",
      title: "Community Food Distribution",
      cause: "Food security",
      description: "Pack boxes",
      address: "12 Main",
      coordinator: "Casey",
      capacity: 20,
      duration: "2 hours",
      impactMetric: "boxes packed",
      training: ["Safety"],
      requirements: ["Closed-toe shoes"],
    },
  ],
  shifts: [
    {
      id: "sh-1",
      opportunityId: "opp-food",
      startsAt: "2030-06-01T13:00:00.000Z",
      endsAt: "2030-06-01T16:00:00.000Z",
      capacity: 8,
      confirmed: 0,
      waitlisted: 0,
      status: "scheduled" as const,
      roles: [{ name: "Greeter", required: 2, filled: 0 }],
    },
    {
      id: "sh-canceled",
      opportunityId: "opp-food",
      startsAt: "2030-06-02T13:00:00.000Z",
      endsAt: "2030-06-02T16:00:00.000Z",
      capacity: 8,
      confirmed: 0,
      waitlisted: 0,
      status: "canceled" as const,
      roles: [],
    },
  ],
} as unknown as Pick<DemoWorkspace, "opportunities" | "shifts">;

beforeEach(() => {
  vi.mocked(readReplicaEntities).mockResolvedValue([]);
  vi.mocked(createSharedOpportunity).mockClear();
  vi.mocked(createSharedShift).mockClear();
  vi.mocked(startDesktopSync).mockClear();
  vi.mocked(syncDesktopNow).mockClear();
  vi.mocked(writeWorkspace).mockClear();
});

describe("publishing a local workspace", () => {
  it("selects the workspace, copies the schedule, and uploads once", async () => {
    const result = await publishLocalSchedule(orgId, local);

    expect(writeWorkspace).toHaveBeenCalledWith(orgId);
    expect(startDesktopSync).toHaveBeenCalled();
    expect(createSharedOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Community Food Distribution", training: ["Safety"] }),
      false,
    );
    expect(createSharedShift).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: expect.any(String),
        capacity: 8,
        roles: [{ name: "Greeter", required: 2 }],
      }),
      false,
    );
    expect(syncDesktopNow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ opportunities: 1, shifts: 1, skipped: 1 });
  });

  it("reuses a hosted opportunity with the same title and skips its shift", async () => {
    vi.mocked(readReplicaEntities).mockImplementation(async (_org, entity) => {
      if (entity === "opportunity") {
        return [{ id: "hosted-opp", title: " community food distribution " }];
      }
      if (entity === "shift") {
        return [
          {
            id: "hosted-shift",
            opportunity_id: "hosted-opp",
            starts_at: "2030-06-01T13:00:00.000Z",
          },
        ];
      }
      return [];
    });

    const result = await publishLocalSchedule(orgId, local);

    expect(createSharedOpportunity).not.toHaveBeenCalled();
    expect(createSharedShift).not.toHaveBeenCalled();
    expect(syncDesktopNow).not.toHaveBeenCalled();
    expect(result).toEqual({ opportunities: 0, shifts: 0, skipped: 3 });
  });
});
