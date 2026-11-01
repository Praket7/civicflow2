import { describe, expect, it } from "vitest";
import { csvCell, csvText } from "./csv";

describe("csv", () => {
  it("quotes commas, quotes, and newlines the way a spreadsheet expects", () => {
    expect(csvCell("Pantry")).toBe("Pantry");
    expect(csvCell('Pantry, "East"')).toBe('"Pantry, ""East"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("turns an empty or missing value into an empty cell", () => {
    expect(csvCell("")).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
  });

  it("stops a leading formula character from executing in a spreadsheet", () => {
    expect(csvCell('=HYPERLINK("https://example.org")')).toContain("'=HYPERLINK");
    expect(csvCell("+1 (716) 555-0100")).toBe("'+1 (716) 555-0100");
    expect(csvCell("-5 hours")).toBe("'-5 hours");
    expect(csvCell("@handle")).toBe("'@handle");
  });

  it("joins rows with CRLF so Windows and macOS both see one row per line", () => {
    expect(
      csvText([
        ["Name", "Hours"],
        ["Alice, Able", 3],
      ]),
    ).toBe('Name,Hours\r\n"Alice, Able",3');
  });
});
