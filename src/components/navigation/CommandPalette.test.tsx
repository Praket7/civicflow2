import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { HelpProvider } from "../help/HelpDialog";
import { CommandPalette } from "./CommandPalette";

vi.mock("../../lib/auth/session", () => ({
  useAuth: () => ({ user: { role: "coordinator" } }),
}));

// jsdom does not implement the dialog element's modal methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

function Harness({ path }: { path: string }) {
  const [open, setOpen] = useState(true);
  return (
    <MemoryRouter initialEntries={[path]}>
      <HelpProvider>
        <CommandPalette open={open} onClose={() => setOpen(false)} />
      </HelpProvider>
    </MemoryRouter>
  );
}

describe("command palette", () => {
  it("opens the current screen's help from the first row", async () => {
    render(<Harness path="/coordinator/coverage" />);

    const help = await screen.findByRole("option", { name: /Help for this screen/ });
    await userEvent.click(help);

    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Coverage command center");
    expect(screen.queryByRole("dialog", { name: "Search CivicFlow" })).not.toBeInTheDocument();
  });

  it("narrows to help when the query asks for it", async () => {
    render(<Harness path="/coordinator/schedule" />);
    await userEvent.type(screen.getByRole("combobox"), "help");
    expect(screen.getByRole("option", { name: /Help for this screen/ })).toBeInTheDocument();
  });
});
