import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { SharedReport } from "../../lib/sync/sharedReports";
import { FunderPacket, funderPacketSections, PACKET_PROGRAM_LIMIT } from "./FunderPacket";

function reportWith(programCount: number): SharedReport {
  return {
    from: "2026-01-01",
    to: "2026-10-31",
    generatedAt: "2026-11-01T12:00:00Z",
    hasData: true,
    totals: {
      verifiedMinutes: 6000,
      pendingMinutes: 120,
      volunteers: 40,
      newVolunteers: 6,
      shiftsCompleted: 30,
      registrations: 60,
      attended: 54,
      noShows: 6,
      attendanceRate: 90,
    },
    programs: Array.from({ length: programCount }, (_, index) => ({
      id: `opp-${index}`,
      title: `Program ${String(index + 1).padStart(2, "0")}`,
      cause: "Food security",
      verifiedMinutes: 600 - index,
      pendingMinutes: 0,
      volunteers: 4,
      shiftsCompleted: 3,
      attended: 12,
    })),
    months: [{ key: "2026-01", verifiedMinutes: 600, pendingMinutes: 0 }],
    credentials: { valid: 3, expiring: 1, expired: 0, unverified: 0, expiringSoon: [] },
  } as unknown as SharedReport;
}

function renderPacket(programCount: number) {
  const report = reportWith(programCount);
  return render(
    <MemoryRouter>
      <FunderPacket
        sections={funderPacketSections({
          report,
          organizationName: "Rivergate Kitchen",
          rangeLabel: "Jan 1, 2026 – Oct 31, 2026",
          selectedProgramTitle: "All programs",
          revision: 12,
          pendingLabel: "0",
        })}
      />
    </MemoryRouter>,
  );
}

describe("funder packet", () => {
  it("keeps the program table to a page and says where the rest are", () => {
    renderPacket(200);
    const table = screen.getByTestId("packet-programs");
    expect(within(table).getAllByRole("row")).toHaveLength(PACKET_PROGRAM_LIMIT + 1);
    expect(within(table).queryByText("Program 19")).not.toBeInTheDocument();
    expect(
      screen.getByText(/showing the 18 programs with the most verified hours; 182 more/i),
    ).toBeInTheDocument();
  });

  it("adds no truncation note when every program fits", () => {
    renderPacket(4);
    expect(screen.getByTestId("packet-programs")).toHaveTextContent("Program 04");
    expect(screen.queryByText(/more are in the app and the CSV export/i)).not.toBeInTheDocument();
  });
});
