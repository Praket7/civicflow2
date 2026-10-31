import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HelpProvider } from "./HelpDialog";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HelpProvider>
        <button type="button">Screen action</button>
      </HelpProvider>
    </MemoryRouter>,
  );
}

describe("contextual help", () => {
  it("opens on ? with the current screen's guide and rules", async () => {
    renderAt("/coordinator/coverage");
    fireEvent.keyDown(window, { key: "?" });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Coverage command center" })).toBeInTheDocument();
    expect(screen.getByText(/required role is empty/)).toBeInTheDocument();
    expect(screen.getByText(/role coverage from seat fill/i)).toBeInTheDocument();
  });

  it("closes with Escape and returns focus to the page", async () => {
    renderAt("/coordinator/mission-control");
    fireEvent.keyDown(window, { key: "?" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not steal ? while the user is typing", async () => {
    render(
      <MemoryRouter initialEntries={["/coordinator/schedule"]}>
        <HelpProvider>
          <input aria-label="Search" />
        </HelpProvider>
      </MemoryRouter>,
    );
    const input = screen.getByRole("textbox", { name: "Search" });
    await userEvent.click(input);
    await userEvent.type(input, "?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has no serious axe violations", async () => {
    const { container } = renderAt("/coordinator/autoroster");
    fireEvent.keyDown(window, { key: "?" });
    await screen.findByRole("dialog");
    const results = await axe(container);
    const blocking = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking).toEqual([]);
  });
});
