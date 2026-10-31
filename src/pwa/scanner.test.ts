import { parseScannedCode } from "./scanner";

describe("scanned check-in codes", () => {
  it("reads the kiosk deep link", () => {
    expect(parseScannedCode("civicflow://checkin/abc123")).toBe("abc123");
  });

  it("decodes an escaped token", () => {
    expect(parseScannedCode("civicflow://checkin/a%20b")).toBe("a b");
  });

  it("reads a code from a printed web link", () => {
    expect(parseScannedCode("https://example.org/checkin?code=482913")).toBe("482913");
  });

  it("accepts a plain six-digit code", () => {
    expect(parseScannedCode(" 482913 ")).toBe("482913");
  });

  it("refuses an unrelated link rather than sending its text as a code", () => {
    expect(parseScannedCode("https://example.org/hello")).toBe("");
  });
});
