/**
 * The preview and the print dialog share Letter paper, so the preview can pack
 * the packet's sections with the same measurements the browser uses. Sections
 * are kept whole here: a funder packet is a summary, and a heading separated
 * from its table reads worse than one extra page.
 */

export const LETTER_HEIGHT_PX = 11 * 96;

const MM_TO_PX = 96 / 25.4;

/** The packet's own paper margins, mirrored from the print stylesheet. */
export const PACKET_VERTICAL_PADDING_PX = 14 * MM_TO_PX + 16 * MM_TO_PX;

export const PACKET_PAGE_CONTENT_HEIGHT = LETTER_HEIGHT_PX - PACKET_VERTICAL_PADDING_PX;

export interface PacketSectionHeight {
  key: string;
  height: number;
}

export function paginatePacketSections(
  sections: PacketSectionHeight[],
  pageHeight = PACKET_PAGE_CONTENT_HEIGHT,
): string[][] {
  if (sections.length === 0) return [];

  const pages: string[][] = [];
  let page: string[] = [];
  let used = 0;

  for (const section of sections) {
    const height = Number.isFinite(section.height) ? Math.max(0, section.height) : 0;
    // A section taller than a page starts its own page and grows the sheet
    // rather than disappearing below a hidden fold.
    if (page.length > 0 && used + height > pageHeight) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(section.key);
    used += height;
  }

  if (page.length > 0) pages.push(page);
  return pages;
}
