import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DesktopReplicaPage } from "./DesktopReplicaPage";

describe("desktop replica page", () => {
  it("explains that the encrypted replica lives in the desktop app", async () => {
    render(
      <MemoryRouter>
        <DesktopReplicaPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "This screen lives in the desktop app" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Synced copy" })).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Hosted workspace" })) {
      expect(link).toHaveAttribute("href", "/shared");
    }
  });
});
