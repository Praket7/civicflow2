import { formatCalendarDate } from "./sharedFormat";

const HOURS = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const MONTH = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });
const PACKET_MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/** One decimal place, because an approved minute is still a minute. */
export function formatHours(minutes: number): string {
  return HOURS.format(Math.round((minutes / 60) * 10) / 10);
}

export function formatReportDate(key: string): string {
  return formatCalendarDate(key);
}

export function formatReportMonth(key: string): string {
  const date = new Date(`${key}-01T12:00:00`);
  return Number.isNaN(date.getTime()) ? key : MONTH.format(date);
}

/** A funder reads the packet away from the dashboard, so spell the month out. */
export function formatPacketMonth(key: string): string {
  const date = new Date(`${key}-01T12:00:00`);
  return Number.isNaN(date.getTime()) ? key : PACKET_MONTH.format(date);
}
