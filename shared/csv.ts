/**
 * CSV output.
 *
 * Small enough not to warrant a dependency, but not trivial: two of the three
 * rules here exist because getting them wrong is silent rather than loud.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Escape one field.
 *
 * Quoting is the ordinary CSV rule. The formula guard is the interesting one: a
 * product named `=HYPERLINK("http://evil","Click")` is a live formula the moment
 * the file opens in Excel or Sheets, and product names and cart options are
 * typed by merchants and buyers. Prefixing with an apostrophe is what both
 * applications read as "this is text".
 */
export type CsvValue = string | number | boolean | null | undefined;

export function csvField(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value);

  const guarded =
    text.length > 0 && FORMULA_PREFIXES.includes(text[0]!) ? `'${text}` : text;

  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function csvRow(fields: readonly CsvValue[]): string {
  // CRLF, because that is what RFC 4180 says and what Excel is happiest with.
  return `${fields.map(csvField).join(",")}\r\n`;
}

/**
 * Byte-order mark.
 *
 * Excel assumes the system codepage for a .csv without one, so an accented
 * product name arrives mojibaked. Every other reader ignores it.
 */
export const CSV_BOM = "﻿";
