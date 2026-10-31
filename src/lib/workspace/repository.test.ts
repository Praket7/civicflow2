import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSnapshot, previewRepository } from "./previewRepository";
import { getWorkspaceRepository, setRepositoryToken } from "./repository";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const snapshot = createDefaultSnapshot();

describe("workspace repository", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(snapshot);
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("uses the browser fallback when the native host is absent", async () => {
    const repository = getWorkspaceRepository();
    expect(repository.source).toBe("preview");
    const state = await repository.getSnapshot();
    expect(state.applications).toHaveLength(7);
    expect(state.waitlist).toHaveLength(4);
    expect(state.settings.organizationName).toBe("Rivergate Kitchen");
  });

  it("maps every desktop write to its Rust command and camelCase arguments", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    vi.mocked(invoke).mockResolvedValue(snapshot);
    setRepositoryToken("session-token");
    const repository = getWorkspaceRepository();
    expect(repository.source).toBe("desktop");

    await repository.getSnapshot();
    await repository.setSaved("opp-garden", false);
    await repository.setApplicationStage("app-001", "review");
    await repository.checkIn("sh-tue-pantry", "vol-maya", "482913");
    await repository.checkOut("sh-tue-pantry", "vol-maya");
    await repository.markNoShow("sh-tue-pantry", "vol-054");
    await repository.promoteWaitlist("sh-sat-food", "vol-054");
    await repository.reviewHours("hours-maya-4", {
      status: "verified",
      approvedMinutes: 480,
      reason: "Trimmed travel time",
      reviewedAt: "2026-10-13T07:45:00-04:00",
    });
    await repository.updateSettings({ defaultShiftLength: 240 });
    await repository.createOpportunity({
      title: "Weekend Pantry Restock",
      cause: "food",
      description: "Restock shelves and load delivery boxes for Saturday routes.",
      address: "214 Rivergate Avenue, Buffalo, NY",
      capacity: 12,
      duration: "2 hours",
      requirements: ["Driver"],
    });
    await repository.registerForShift("sh-sat-food", "vol-maya", "Driver");
    await repository.saveVolunteerProfile({
      skills: ["Spanish"],
      availability: [{ day: "wed", period: "morning" }],
      completedOnboarding: true,
    });
    await repository.applyRoster("sh-sat-food", [
      { candidateId: "vol-002", role: "Driver", promoteWaitlist: false },
    ]);
    await repository.resetDemo();
    await repository.createAccount("Alicia Moreno", "alicia.moreno@example.org", "second-saturday");

    const calls = vi.mocked(invoke).mock.calls;
    expect(calls.map(([command]) => command)).toEqual([
      "get_workspace_snapshot",
      "set_saved_opportunity",
      "set_application_stage",
      "check_in_volunteer",
      "check_out_volunteer",
      "mark_volunteer_no_show",
      "promote_waitlist",
      "review_hours",
      "update_workspace_settings",
      "create_opportunity",
      "register_for_shift",
      "save_volunteer_profile",
      "apply_roster_plan",
      "reset_demo",
      "create_account",
    ]);
    expect(calls[0][1]).toEqual({ token: "session-token" });
    expect(calls[1][1]).toEqual({
      opportunityId: "opp-garden",
      saved: false,
      token: "session-token",
    });
    expect(calls[2][1]).toEqual({
      applicationId: "app-001",
      stage: "review",
      token: "session-token",
    });
    expect(calls[7][1]).toEqual({
      entryId: "hours-maya-4",
      status: "verified",
      approvedMinutes: 480,
      reason: "Trimmed travel time",
      token: "session-token",
    });
    expect(calls[8][1]).toEqual({
      patch: { defaultShiftLength: 240 },
      token: "session-token",
    });
    expect(calls[10][1]).toEqual({
      shiftId: "sh-sat-food",
      volunteerId: "vol-maya",
      role: "Driver",
      token: "session-token",
    });
    expect(calls[11][1]).toEqual({
      skills: ["Spanish"],
      availability: [{ day: "wed", period: "morning" }],
      completedOnboarding: true,
      phone: "",
      interests: "",
      causes: [],
      photo: "",
      token: "session-token",
    });
    expect(calls[12][1]).toEqual({
      shiftId: "sh-sat-food",
      assignments: [{ candidateId: "vol-002", role: "Driver", promoteWaitlist: false }],
      token: "session-token",
    });
    expect(calls[14][1]).toEqual({
      name: "Alicia Moreno",
      email: "alicia.moreno@example.org",
      password: "second-saturday",
    });
    setRepositoryToken(null);
  });

  it("creates a preview identity that can sign in with its own password", async () => {
    const created = await previewRepository.createAccount(
      "  Alicia   Moreno ",
      "Alicia.Moreno@Example.org",
      "second-saturday",
    );
    expect(created.user).toMatchObject({
      name: "Alicia Moreno",
      email: "alicia.moreno@example.org",
      // Signing up creates an identity, not a role. Membership supplies one.
      role: "none",
      volunteerId: null,
    });

    const session = await previewRepository.signIn(
      "alicia.moreno@example.org",
      "second-saturday",
      false,
    );
    expect(session.user.id).toBe(created.user.id);
    expect((await previewRepository.currentUser(session.token))?.id).toBe(created.user.id);

    await expect(
      previewRepository.createAccount(
        "Alicia Moreno",
        "alicia.moreno@example.org",
        "another-password",
      ),
    ).rejects.toThrow(/already uses that email/);
    await expect(
      previewRepository.createAccount("Alicia Moreno", "alicia@example.org", "short"),
    ).rejects.toThrow(/at least 8 characters/);
  });

  it("preview cancellation promotes the next eligible waitlist candidate", async () => {
    await previewRepository.resetDemo();
    const state = await previewRepository.cancelRegistration(
      "sh-sat-food",
      "vol-045",
      "Family emergency",
    );
    expect(
      state.registrations.find(
        (row) => row.shiftId === "sh-sat-food" && row.volunteerId === "vol-045",
      )?.status,
    ).toBe("canceled");
    expect(
      state.registrations.find(
        (row) => row.shiftId === "sh-sat-food" && row.volunteerId === "vol-maya",
      )?.status,
    ).toBe("registered");
    expect(
      state.waitlist.find((row) => row.shiftId === "sh-sat-food" && row.volunteerId === "vol-maya")
        ?.status,
    ).toBe("promoted");
    expect(state.audit.some((event) => event.action === "waitlist.promote")).toBe(true);
    await previewRepository.resetDemo();
  });

  it("preview no-show releases the seat once and keeps the absence visible", async () => {
    await previewRepository.resetDemo();
    const before = await previewRepository.getSnapshot();
    const seat = before.registrations.find(
      (row) => row.shiftId === "sh-thu-food" && row.status === "registered",
    );
    expect(seat).toBeDefined();
    if (!seat) return;

    const state = await previewRepository.markNoShow("sh-thu-food", seat.volunteerId);
    expect(
      state.registrations.find(
        (row) => row.shiftId === "sh-thu-food" && row.volunteerId === seat.volunteerId,
      )?.status,
    ).toBe("no_show");
    expect(
      state.attendance["sh-thu-food"]?.find((row) => row.volunteerId === seat.volunteerId)?.role,
    ).toBe(seat.role);

    // Marking the same person twice is a no-op, not a second released seat.
    const repeated = await previewRepository.markNoShow("sh-thu-food", seat.volunteerId);
    expect(repeated.audit.filter((event) => event.action === "shift.no_show")).toHaveLength(1);
    await previewRepository.resetDemo();
  });

  it("refuses a no-show for somebody who already checked in", async () => {
    await previewRepository.resetDemo();
    const code = await previewRepository.getCheckinCode("sh-tue-pantry");
    await previewRepository.checkIn("sh-tue-pantry", "vol-maya", code.code);
    await expect(previewRepository.markNoShow("sh-tue-pantry", "vol-maya")).rejects.toThrow(
      /already checked in/,
    );
    await previewRepository.resetDemo();
  });

  it("reads the self check-in window from the domain", async () => {
    await previewRepository.resetDemo();
    const open = await previewRepository.checkinWindow("sh-tue-pantry");
    expect(open).toMatchObject({ status: "open", canSelfCheckIn: true });
    expect(open.opensAt).toBe("2026-10-13T11:30:00.000Z");
    expect(open.closesAt).toBe("2026-10-13T12:15:00.000Z");

    const early = await previewRepository.checkinWindow("sh-sat-food");
    expect(early).toMatchObject({ status: "not_open", canSelfCheckIn: false });
    await expect(previewRepository.checkIn("sh-sat-food", "vol-maya", "000000")).rejects.toThrow(
      /opens 30 minutes/,
    );
    await previewRepository.resetDemo();
  });

  it("restores a preview snapshot and audits the restore", async () => {
    await previewRepository.resetDemo();
    const [backup] = await previewRepository.createBackup("Contract backup");
    expect(backup).toBeDefined();
    if (!backup) return;

    const baseline = await previewRepository.getSnapshot();
    const pantryCode = await previewRepository.getCheckinCode("sh-tue-pantry");
    await previewRepository.checkIn("sh-tue-pantry", "vol-maya", pantryCode.code);
    const mutated = await previewRepository.setSaved("opp-garden", false);
    expect(mutated.attendance["sh-tue-pantry"]).toHaveLength(
      (baseline.attendance["sh-tue-pantry"]?.length ?? 0) + 1,
    );
    expect(mutated.savedOpportunityIds).not.toContain("opp-garden");

    const result = await previewRepository.restoreBackup(backup.id);
    expect(result.snapshot.attendance).toEqual(baseline.attendance);
    expect(result.snapshot.savedOpportunityIds).toContain("opp-garden");
    expect(result.snapshot.audit[0]).toMatchObject({
      action: "backup.restore",
      entityId: backup.id,
    });
    expect(result.backups[0]?.note).toBe(`Before restoring ${backup.id}`);
  });

  it("refuses unknown or malformed preview snapshots", async () => {
    await previewRepository.resetDemo();
    await expect(previewRepository.restoreBackup("missing")).rejects.toThrow(/not available/);

    const [backup] = await previewRepository.createBackup("Tamper target");
    expect(backup).toBeDefined();
    if (!backup) return;
    const stored = JSON.parse(localStorage.getItem("civicflow.backups.v1") ?? "[]") as Array<{
      meta: unknown;
      snapshot: unknown;
    }>;
    stored[0] = { ...stored[0], snapshot: { nope: true } };
    localStorage.setItem("civicflow.backups.v1", JSON.stringify(stored));

    const before = await previewRepository.getSnapshot();
    await expect(previewRepository.restoreBackup(backup.id)).rejects.toThrow(
      /incomplete or foreign/,
    );
    expect(await previewRepository.getSnapshot()).toEqual(before);
  });

  it("keeps only the newest twenty preview snapshots", async () => {
    await previewRepository.resetDemo();
    for (let index = 0; index < 25; index += 1) {
      await previewRepository.createBackup(`Retention ${index}`);
    }

    const backups = await previewRepository.listBackups();
    expect(backups).toHaveLength(20);
    expect(backups[0]?.note).toBe("Retention 24");
    expect(backups[19]?.note).toBe("Retention 5");
    expect(backups.some((backup) => backup.note === "Retention 4")).toBe(false);
  });

  it("keeps preview writes in one snapshot", async () => {
    await previewRepository.resetDemo();
    const pantryCode = await previewRepository.getCheckinCode("sh-tue-pantry");
    const state = await previewRepository.checkIn("sh-tue-pantry", "vol-maya", pantryCode.code);
    expect(state.attendance["sh-tue-pantry"]?.[0]?.status).toBe("checked_in");
    const saved = await previewRepository.setSaved("opp-park", true);
    expect(saved.savedOpportunityIds).toContain("opp-park");
    const reviewed = await previewRepository.reviewHours("hours-maya-4", {
      status: "verified",
      approvedMinutes: 540,
      reason: "Approved as submitted",
      reviewedAt: "2026-10-13T07:45:00-04:00",
    });
    expect(reviewed.hoursDecisions["hours-maya-4"]?.status).toBe("verified");
    const applied = await previewRepository.applyRoster("sh-sat-food", [
      { candidateId: "vol-002", role: "Driver", promoteWaitlist: false },
    ]);
    expect(
      applied.registrations.find(
        (row) => row.shiftId === "sh-sat-food" && row.volunteerId === "vol-002",
      )?.role,
    ).toBe("Driver");
    expect(applied.audit[0]?.action).toBe("autoroster.apply");
    await previewRepository.resetDemo();
  });
});
