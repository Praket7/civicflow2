import { downloadFile } from "./download";

export type CsvValue = string | number | boolean | null | undefined;

/**
 * RFC 4180 quoting with one addition: a spreadsheet treats a leading =, +, - or
 * @ as a formula, so the cell is prefixed with an apostrophe before it can be
 * quoted. A signed number or a phone number is not a formula, so it keeps its
 * leading sign instead of gaining a visible apostrophe in the file.
 */
export function csvCell(value: CsvValue): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const formulaLike = /^[=@]/.test(raw) || (/^[+-]/.test(raw) && !/^[+-][\d\s().-]*$/.test(raw));
  const neutral = formulaLike ? `'${raw}` : raw;
  return /[",\r\n]/.test(neutral) ? `"${neutral.replace(/"/g, '""')}"` : neutral;
}

export function csvRow(row: CsvValue[]): string {
  return row.map(csvCell).join(",");
}

export function csvText(rows: CsvValue[][]): string {
  return rows.map(csvRow).join("\r\n");
}

/**
 * Excel only reads UTF-8 CSV reliably with a byte-order mark, so every export
 * carries one. The trailing newline keeps the last row from being merged into
 * the next import.
 */
export function downloadCsv(filename: string, rows: CsvValue[][]): Blob {
  return downloadFile(filename, `\uFEFF${csvText(rows)}\r\n`, "text/csv;charset=utf-8");
}
