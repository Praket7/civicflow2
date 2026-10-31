import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectField, TextareaField, TextField } from "./Form";

describe("form fields", () => {
  it("points an invalid field at its error message", () => {
    render(<TextField label="Email" error="Enter an email address." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Enter an email address.");
  });

  it("points a field with guidance at its hint", () => {
    render(<TextField label="Capacity" hint="People, not slots." />);
    const input = screen.getByLabelText("Capacity");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toHaveTextContent(
      "People, not slots.",
    );
  });

  it("keeps an existing description and appends the error", () => {
    render(<TextField label="Hours" aria-describedby="outside-help" error="Use whole minutes." />);
    const input = screen.getByLabelText("Hours");
    expect(input.getAttribute("aria-describedby")).toMatch(/outside-help/);
    expect(input.getAttribute("aria-describedby")).toMatch(/-error$/);
  });

  it("marks selects and textareas invalid too", () => {
    render(
      <>
        <SelectField label="Role" error="Pick a role.">
          <option>Driver</option>
        </SelectField>
        <TextareaField label="Note" error="Add a note." />
      </>,
    );
    expect(screen.getByLabelText("Role")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Note")).toHaveAttribute("aria-invalid", "true");
  });
});
