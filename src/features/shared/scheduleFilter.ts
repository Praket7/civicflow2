import { text, type SharedRow } from "../../lib/sync/sharedReplica";

/**
 * A realistic organization can hold hundreds of programs and thousands of
 * shifts. The replica is complete, but a screen that prints every row is not
 * usable: finding one shift means scrolling and the DOM grows with the
 * organization. The filter narrows by what a coordinator actually knows, and
 * the page size keeps the first paint small until they ask for everything.
 */

export const OPPORTUNITY_PAGE = 25;
export const SHIFT_PAGE = 100;

export function filterOpportunities(rows: SharedRow[], query: string): SharedRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    [text(row, "title"), text(row, "cause"), text(row, "address")].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}

export function filterShifts(
  rows: SharedRow[],
  query: string,
  opportunityTitle: (opportunityId: string) => string,
  when: (value: unknown) => string,
): SharedRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    [
      opportunityTitle(text(row, "opportunity_id")),
      text(row, "status") || "scheduled",
      when(row.starts_at),
    ].some((value) => value.toLowerCase().includes(needle)),
  );
}
