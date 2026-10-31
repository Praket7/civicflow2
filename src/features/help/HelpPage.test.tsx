import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../../lib/auth/session";
import { HelpPage } from "./HelpPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/help"]}>
      <AuthProvider>
        <HelpPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Help page", () => {
  it("renders both journeys, shortcuts, and no serious axe violations", async () => {
    const { container } = renderPage();

    expect(await screen.findByRole("heading", { name: "How CivicFlow works" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run a service week" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "From interest to impact" })).toBeInTheDocument();
    expect(screen.getByText("Search every screen from anywhere.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Schedule/ })).toHaveAttribute(
      "href",
      "/coordinator/schedule",
    );

    const results = await axe(container);
    const blocking = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking).toEqual([]);
  });

  it("lists every screen guide and filters them from the search field", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Guides in place" });
    expect(screen.getByRole("link", { name: "Coverage command center" })).toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "Search help" });
    await userEvent.type(search, "waitlist");
    expect(screen.getAllByRole("heading", { name: "Shift detail" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Impact analytics" })).not.toBeInTheDocument();
  });

  it("documents the glossary and the rules that reject input", async () => {
    renderPage();
    const glossary = await screen.findByRole("heading", { name: "The words on the screen" });
    expect(glossary).toBeInTheDocument();
    expect(screen.getByText("Role coverage")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Rules that reject input" })).toBeInTheDocument();
    expect(
      screen.getByText("A sealed archive needs a passphrase of at least 12 characters."),
    ).toBeInTheDocument();
  });
});
