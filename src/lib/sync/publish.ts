import type { DemoWorkspace } from "../../types/domain";
import { writeWorkspace } from "./db";
import { desktopSyncSnapshot, startDesktopSync, syncDesktopNow } from "./desktop";
import { readReplicaEntities } from "./desktopStore";
import { createSharedOpportunity, createSharedShift } from "./writes";

export interface PublishResult {
  opportunities: number;
  shifts: number;
  skipped: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function instant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * Copies the local schedule into the selected hosted organization.
 *
 * This is deliberately not a wholesale database upload: volunteers, hours and
 * attendance belong to people, and a coordinator should not duplicate them by
 * accident. What a new shared organization needs is its programs and their
 * published shifts. Matching titles and start times make the command safe to
 * run twice; every other row is queued once and the server still validates it.
 */
export async function publishLocalSchedule(
  organizationId: string,
  workspace: Pick<DemoWorkspace, "opportunities" | "shifts">,
): Promise<PublishResult> {
  if (!organizationId) throw new Error("Choose a hosted organization first.");

  // The remembered workspace is what sync configures and what the outbox is
  // bound to. Selecting it is part of publishing, not a separate user step.
  await writeWorkspace(organizationId);
  // Publishing decides what is already present, so read a fresh snapshot
  // rather than a cursor replay that may be one poll behind.
  await startDesktopSync(true);
  const state = desktopSyncSnapshot();
  if (state.organizationId !== organizationId) {
    throw new Error("The shared workspace did not open. Reconnect it under Settings first.");
  }
  if (!state.online) {
    throw new Error("Connect to the organization before publishing the local schedule.");
  }

  const [existingOpportunities, existingShifts] = await Promise.all([
    readReplicaEntities(organizationId, "opportunity", 500),
    readReplicaEntities(organizationId, "shift", 1000),
  ]);

  const hostedByTitle = new Map(
    existingOpportunities.map((row) => {
      const title = typeof row.title === "string" ? normalize(row.title) : "";
      return [title, String(row.id)] as const;
    }),
  );
  const hostedShiftKeys = new Set(
    existingShifts.map(
      (row) => `${String(row.opportunity_id)}|${instant(String(row.starts_at ?? ""))}`,
    ),
  );

  let opportunities = 0;
  let shifts = 0;
  let skipped = 0;
  const opportunityIds = new Map<string, string>();
  const localShiftKeys = new Set<string>();

  for (const opportunity of workspace.opportunities) {
    const title = normalize(opportunity.title);
    if (!title) {
      skipped += 1;
      continue;
    }
    const existing = hostedByTitle.get(title);
    if (existing) {
      opportunityIds.set(opportunity.id, existing);
      skipped += 1;
      continue;
    }

    const id = crypto.randomUUID();
    await createSharedOpportunity(
      {
        id,
        title: opportunity.title,
        cause: opportunity.cause,
        description: opportunity.description,
        address: opportunity.address,
        coordinator: opportunity.coordinator,
        capacity: opportunity.capacity,
        duration: opportunity.duration,
        impactMetric: opportunity.impactMetric,
        training: opportunity.training,
        requirements: opportunity.requirements,
      },
      false,
    );
    hostedByTitle.set(title, id);
    opportunityIds.set(opportunity.id, id);
    opportunities += 1;
  }

  for (const shift of workspace.shifts) {
    if (shift.status === "canceled") {
      skipped += 1;
      continue;
    }
    const opportunityId = opportunityIds.get(shift.opportunityId);
    if (!opportunityId) {
      skipped += 1;
      continue;
    }
    const key = `${opportunityId}|${instant(shift.startsAt)}`;
    if (hostedShiftKeys.has(key) || localShiftKeys.has(key)) {
      skipped += 1;
      continue;
    }
    localShiftKeys.add(key);
    await createSharedShift(
      {
        opportunityId,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        capacity: shift.capacity,
        roles: shift.roles.map((role) => ({ name: role.name, required: role.required })),
      },
      false,
    );
    shifts += 1;
  }

  if (opportunities > 0 || shifts > 0) {
    await syncDesktopNow();
  }
  return { opportunities, shifts, skipped };
}
