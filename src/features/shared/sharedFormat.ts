/**
 * One date vocabulary for the shared screens. Stored timestamps are instants
 * and use the reader's locale; a calendar date written as YYYY-MM-DD is read at
 * noon so a timezone west of UTC cannot move it to the previous day.
 */

const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DATE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** A shift or activity instant, with a useful fallback for an empty field. */
export function formatWhen(value: unknown, fallback = "Not scheduled"): string {
  if (typeof value !== "string" || value === "") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : WHEN.format(date);
}

/** A date-only field such as a credential's expiry or a join date. */
export function formatCalendarDate(value: unknown, fallback = "No date"): string {
  if (typeof value !== "string" || value === "") return fallback;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : DATE.format(date);
}
