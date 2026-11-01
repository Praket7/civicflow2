import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SharedConflictsPage } from "./SharedConflictsPage";
import { SharedParticipationPage } from "./SharedParticipationPage";
import { SharedSchedulePage } from "./SharedSchedulePage";
import { SharedVolunteersPage } from "./SharedVolunteersPage";

function renderPage(page: ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe("shared coordinator screens", () => {
  it.each([
    ["Schedule", <SharedSchedulePage key="schedule" />],
    ["Participation", <SharedParticipationPage key="participation" />],
    ["Volunteers", <SharedVolunteersPage key="volunteers" />],
    ["Sync issues", <SharedConflictsPage key="conflicts" />],
  ])("%s explains that writes live in the desktop app", async (title, page) => {
    renderPage(page);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "This screen lives in the desktop app" }),
    ).toBeInTheDocument();
  });

  it("links the three shared surfaces from their navigation", async () => {
    renderPage(<SharedSchedulePage />);
    expect(await screen.findByRole("link", { name: "Participation" })).toHaveAttribute(
      "href",
      "/shared/participation",
    );
    expect(screen.getByRole("link", { name: "Volunteers" })).toHaveAttribute(
      "href",
      "/shared/volunteers",
    );
    expect(screen.getByRole("link", { name: "Conflicts" })).toHaveAttribute(
      "href",
      "/shared/conflicts",
    );
    expect(screen.getByRole("link", { name: "Synced copy" })).toHaveAttribute(
      "href",
      "/shared/replica",
    );
  });
});
