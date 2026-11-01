import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedReportsPage } from "./SharedReportsPage";

vi.mock("../../lib/sync/sharedReportSource", () => ({
  useSharedReportData: () => ({
    sync: {
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      membershipEpoch: 1,
      organizationName: "Rivergate Kitchen",
      phase: "ready",
      online: true,
      configured: true,
      cursor: 12,
      entities: 9,
      revision: 7,
      pending: 2,
      conflicts: 0,
      lastSyncedAt: null,
      error: null,
    },
    data: {
      opportunities: [
        { id: "p1", title: "Pantry" },
        { id: "p2", title: "Tutoring" },
      ],
      shifts: [
        {
          id: "s1",
          opportunity_id: "p1",
          starts_at: "2026-01-10T15:00:00Z",
          status: "completed",
        },
        {
          id: "s2",
          opportunity_id: "p2",
          starts_at: "2026-03-10T15:00:00Z",
          status: "completed",
        },
      ],
      volunteers: [
        { id: "v1", name: "Alice Able" },
        { id: "v2", name: "Bob Baker" },
      ],
      registrations: [
        { id: "r1", shift_id: "s1", volunteer_id: "v1", status: "completed" },
        { id: "r2", shift_id: "s2", volunteer_id: "v2", status: "confirmed" },
      ],
      attendance: [
        { id: "a1", shift_id: "s1", volunteer_id: "v1", status: "completed" },
        { id: "a2", shift_id: "s2", volunteer_id: "v2", status: "no_show" },
      ],
      hourEntries: [
        {
          id: "h0",
          volunteer_id: "v2",
          opportunity_id: "p2",
          date: "2025-12-01",
          minutes: 60,
          status: "verified",
        },
        {
          id: "h1",
          volunteer_id: "v1",
          opportunity_id: "p1",
          source_shift_id: "s1",
          date: "2026-01-10",
          minutes: 120,
          approved_minutes: 120,
          status: "verified",
        },
        {
          id: "h2",
          volunteer_id: "v2",
          opportunity_id: "p2",
          source_shift_id: "s2",
          date: "2026-03-10",
          minutes: 60,
          status: "verified",
        },
        {
          id: "h3",
          volunteer_id: "v1",
          opportunity_id: "p1",
          date: "2026-01-11",
          minutes: 30,
          status: "pending",
        },
      ],
      credentials: [
        {
          id: "c1",
          volunteer_id: "v1",
          credential_type_id: "t1",
          valid_through: "2020-01-01",
          verified_at: "2019-01-01T12:00:00Z",
        },
        {
          id: "c2",
          volunteer_id: "v2",
          credential_type_id: "t1",
          valid_through: "2030-01-01",
          verified_at: "2029-01-01T12:00:00Z",
        },
      ],
      credentialTypes: [{ id: "t1", name: "Food handler" }],
    },
    loading: false,
    error: null,
    reload: vi.fn(async () => {}),
  }),
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

const createObjectURL = vi.fn((_blob: Blob) => "blob:report");

beforeEach(() => {
  document.title = "CivicFlow";
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
  createObjectURL.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount() {
  return render(
    <MemoryRouter>
      <SharedReportsPage />
    </MemoryRouter>,
  );
}

describe("shared impact report", () => {
  it("shows verified hours, participation, attendance, and credential risk", async () => {
    mount();

    expect(
      await screen.findByRole("heading", { name: "Impact report", level: 1 }),
    ).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Report summary" });
    expect(within(summary).getByText("3 h")).toBeInTheDocument();
    expect(within(summary).getByText("0.5 h waiting for review")).toBeInTheDocument();
    expect(within(summary).getByText("1 serving for the first time")).toBeInTheDocument();
    expect(within(summary).getByText("50%")).toBeInTheDocument();
    expect(within(summary).getByText("1 attended · 1 no-show")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Hours by program" })).getByText("Pantry"),
    ).toBeInTheDocument();
    expect(screen.getByText("Food handler")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByTestId("report-footnote").textContent).toContain(
      "Built from the synced copy at revision 7. Waiting to upload: 2 commands.",
    );
  });

  it("narrows the whole report to one program", async () => {
    mount();

    const program = await screen.findByLabelText("Program");
    await userEvent.selectOptions(program, "Tutoring");

    const summary = screen.getByRole("region", { name: "Report summary" });
    expect(within(summary).getByText("1 h")).toBeInTheDocument();
    expect(within(summary).getByText("0 h waiting for review")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Hours by program" })).queryByText("Pantry"),
    ).not.toBeInTheDocument();
  });

  it("exports the report as a CSV download", async () => {
    mount();

    const button = await screen.findByRole("button", { name: "Export CSV" });
    expect(button).toBeEnabled();
    await userEvent.click(button);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(await blob.text()).toContain("CivicFlow shared impact report");
  });

  it("builds a funder packet from aggregates without naming people", async () => {
    mount();

    const packet = await screen.findByTestId("funder-packet");
    expect(packet).toHaveTextContent("Rivergate Kitchen");
    expect(packet).toHaveTextContent("Funder packet");
    expect(within(packet).getByTestId("packet-verified-hours")).toHaveTextContent("3");
    expect(within(packet).getByTestId("packet-programs")).toHaveTextContent("Pantry");
    expect(within(packet).getByTestId("packet-months")).toHaveTextContent("Jan");
    expect(within(packet).getByTestId("packet-method")).toHaveTextContent(
      "This packet leaves out volunteer names and individual credentials.",
    );
    expect(packet).not.toHaveTextContent("Alice Able");
    expect(packet).not.toHaveTextContent("Bob Baker");
    expect(packet).not.toHaveTextContent("Food handler");
  });

  it("opens the print dialog with a report-named PDF", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    mount();

    const button = await screen.findByRole("button", { name: "Print / save PDF" });
    expect(button).toBeEnabled();
    await userEvent.click(button);

    expect(print).toHaveBeenCalledTimes(1);
    expect(document.title).toContain("Rivergate Kitchen impact report");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("CivicFlow");
    print.mockRestore();
  });

  it("previews the packet on Letter pages before printing", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    mount();

    await userEvent.click(await screen.findByRole("button", { name: "Preview" }));
    const dialog = await screen.findByRole("dialog", { name: "Funder packet preview" });

    expect(within(dialog).getByText("Page 1 of 1")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Rivergate Kitchen").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("Alice Able")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    await userEvent.click(within(dialog).getByRole("button", { name: "Print / save PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Funder packet preview" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("splits a measured packet into one sheet per Letter page", async () => {
    const heights: Record<string, number> = {
      header: 40,
      cover: 280,
      programs: 420,
      months: 320,
      participation: 230,
      method: 160,
      footer: 40,
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const key = this.dataset.packetSection;
      const height = key ? (heights[key] ?? 0) : 0;
      return {
        height,
        width: 800,
        top: 0,
        left: 0,
        bottom: height,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    mount();

    await userEvent.click(await screen.findByRole("button", { name: "Preview" }));
    const dialog = await screen.findByRole("dialog", { name: "Funder packet preview" });

    expect(await within(dialog).findByText("Page 1 of 2")).toBeInTheDocument();
    expect(within(dialog).getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("keeps the working screen and the preview off paper", () => {
    const css = readFileSync("src/features/shared/shared.module.css", "utf8");
    const printBlock = css.slice(css.lastIndexOf("@media print"));
    expect(printBlock).toContain(".shell > :not(.packet)");
    expect(printBlock).toContain("display: none !important");
    expect(printBlock).toContain(".packet");
    expect(printBlock).toContain("display: block");
    expect(printBlock).toContain(".previewDialog");
    expect(css).toContain("padding: 14mm 14mm 16mm");
    expect(css).toContain("width: 8.5in");
    expect(css).not.toContain("@page");
  });
});
