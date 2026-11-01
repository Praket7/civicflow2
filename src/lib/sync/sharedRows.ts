/**
 * Reading a replica row. Entities arrive from Postgres as JSON, so a missing
 * column and a null column mean the same thing to a screen; these three
 * readers make that conversion once instead of in every panel.
 */

export type SharedRow = Record<string, unknown> & { id: string };

export function text(row: SharedRow | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

export function number(row: SharedRow | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === "number" ? value : Number(value) || 0;
}
