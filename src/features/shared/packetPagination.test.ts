import { describe, expect, it } from "vitest";
import { paginatePacketSections } from "./packetPagination";

describe("packet pagination", () => {
  it("keeps whole sections on a page until the next one would overflow", () => {
    const pages = paginatePacketSections(
      [
        { key: "header", height: 40 },
        { key: "cover", height: 300 },
        { key: "programs", height: 260 },
        { key: "months", height: 300 },
        { key: "participation", height: 220 },
        { key: "method", height: 140 },
      ],
      900,
    );

    expect(pages).toEqual([
      ["header", "cover", "programs", "months"],
      ["participation", "method"],
    ]);
  });

  it("starts a new page rather than splitting a section at the limit", () => {
    const pages = paginatePacketSections(
      [
        { key: "long", height: 700 },
        { key: "next", height: 300 },
      ],
      800,
    );

    expect(pages).toEqual([["long"], ["next"]]);
  });

  it("gives a section taller than a page its own page", () => {
    const pages = paginatePacketSections(
      [
        { key: "intro", height: 200 },
        { key: "table", height: 1_200 },
        { key: "footer", height: 40 },
      ],
      900,
    );

    expect(pages).toEqual([["intro"], ["table"], ["footer"]]);
  });

  it("handles a layout-less measurement without dropping content", () => {
    const pages = paginatePacketSections([
      { key: "header", height: 0 },
      { key: "cover", height: 0 },
    ]);

    expect(pages).toEqual([["header", "cover"]]);
  });

  it("returns no pages for no sections", () => {
    expect(paginatePacketSections([])).toEqual([]);
  });
});
