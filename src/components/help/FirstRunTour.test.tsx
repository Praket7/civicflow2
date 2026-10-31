import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { FirstRunTour, replayTour } from "./FirstRunTour";

const key = (role: "coordinator" | "volunteer") => `civicflow.tour.v1.${role}`;

function renderTour(role: "coordinator" | "volunteer" = "coordinator") {
  return render(
    <MemoryRouter>
      <FirstRunTour role={role} />
    </MemoryRouter>,
  );
}

describe("first-run tour", () => {
  it("starts at the first step and moves forward", async () => {
    renderTour();
    expect(screen.getByRole("heading", { name: "Start with Mission Control" })).toBeInTheDocument();
    expect(screen.getByText("Guided tour · 1 of 5")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Coverage is not headcount" })).toBeInTheDocument();
    expect(localStorage.getItem(key("coordinator"))).toBe("1");
  });

  it("resumes from the saved step after a relaunch", () => {
    localStorage.setItem(key("coordinator"), "3");
    renderTour();
    expect(screen.getByRole("heading", { name: "The door works offline" })).toBeInTheDocument();
    expect(screen.getByText("Guided tour · 4 of 5")).toBeInTheDocument();
  });

  it("finishes on the last step and stays closed", async () => {
    localStorage.setItem(key("coordinator"), "4");
    renderTour();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(key("coordinator"))).toBe("done");
  });

  it("skips from any step", async () => {
    renderTour();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(key("coordinator"))).toBe("done");
  });

  it("replays on request after the tour is finished", () => {
    localStorage.setItem(key("coordinator"), "done");
    renderTour();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => replayTour("coordinator"));
    expect(screen.getByRole("heading", { name: "Start with Mission Control" })).toBeInTheDocument();
  });

  it("shows the shorter volunteer tour", () => {
    renderTour("volunteer");
    expect(screen.getByRole("heading", { name: "Find a shift that fits" })).toBeInTheDocument();
    expect(screen.getByText("Guided tour · 1 of 4")).toBeInTheDocument();
  });

  it("has no serious axe violations", async () => {
    const { container } = renderTour();
    const results = await axe(container);
    const blocking = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking).toEqual([]);
  });
});
