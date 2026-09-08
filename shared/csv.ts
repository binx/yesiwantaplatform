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

/* ------------------------------------------------------------------- input */

/**
 * Undo the formula guard.
 *
 * `csvField` prefixes an apostrophe onto anything a spreadsheet would evaluate,
 * so a file this codebase wrote and then read back would gain an apostrophe per
 * round trip — which is exactly what the catalogue importer must not do. Only
 * stripped when what follows really is a guarded prefix, so a merchant who
 * typed `'tis` keeps their apostrophe.
 */
export function unguardCsvField(value: string): string {
  return value.startsWith("'") && FORMULA_PREFIXES.includes(value[1] ?? "")
    ? value.slice(1)
    : value;
}

/** One record, with the line it started on so an error can name it. */
export interface CsvRecord {
  /** 1-based line in the file, header included, as a spreadsheet counts. */
  line: number;
  fields: string[];
}

/**
 * An incremental RFC 4180 reader.
 *
 * Incremental rather than a `split` over the whole string because the importer
 * consumes the request stream: a catalogue arrives in chunks, and the row cap
 * has to be able to stop reading before the rest of the file has been
 * buffered. Chunk boundaries fall anywhere — between the two quotes of an
 * escaped `""`, or between the `\r` and `\n` of a line ending — so every
 * partial state is held on the instance rather than in a local.
 */
export class CsvStreamParser {
  #fields: string[] = [];
  #field = "";
  #inQuotes = false;
  /** Saw `"` while inside a quoted field; the next character says why. */
  #afterQuote = false;
  /** The previous character was `\r`, so a `\n` now is the same terminator. */
  #afterCr = false;
  /** Whether the current record has any content, so blank lines are skipped. */
  #started = false;
  #line = 1;
  #recordLine = 1;

  push(chunk: string): CsvRecord[] {
    const records: CsvRecord[] = [];

    for (const char of chunk) {
      const afterCr = this.#afterCr;
      this.#afterCr = false;

      // The `\n` completing a `\r\n` was already handled as the terminator.
      if (afterCr && char === "\n" && !this.#inQuotes) continue;

      if (this.#afterQuote) {
        this.#afterQuote = false;

        // `""` inside a quoted field is one literal quote.
        if (char === '"') {
          this.#field += '"';
          continue;
        }

        // Anything else closed the field; fall through to read this character
        // as the delimiter or terminator it is.
        this.#inQuotes = false;
      } else if (this.#inQuotes) {
        if (char === '"') {
          this.#afterQuote = true;
        } else {
          /*
           * A newline inside quotes is content, not a terminator — but it is
           * still a line. Counting it is what keeps the row numbers in an
           * error report pointing at the same rows the merchant's spreadsheet
           * shows; a single multi-line description would otherwise shift every
           * row number below it.
           */
          if (char === "\r") {
            this.#line += 1;
            this.#afterCr = true;
          } else if (char === "\n" && !afterCr) {
            this.#line += 1;
          }

          this.#field += char;
        }
        continue;
      }

      if (char === '"' && this.#field === "") {
        this.#inQuotes = true;
        this.#started = true;
        continue;
      }

      if (char === ",") {
        this.#endField();
        continue;
      }

      if (char === "\n" || char === "\r") {
        this.#afterCr = char === "\r";
        const record = this.#endRecord();
        if (record) records.push(record);
        continue;
      }

      this.#field += char;
      this.#started = true;
    }

    return records;
  }

  /** Flush the last record, which a file with no trailing newline still has. */
  end(): CsvRecord[] {
    this.#inQuotes = false;
    this.#afterQuote = false;

    const record = this.#endRecord();
    return record ? [record] : [];
  }

  #endField(): void {
    this.#fields.push(this.#field);
    this.#field = "";
    this.#started = true;
  }

  #endRecord(): CsvRecord | null {
    const line = this.#recordLine;
    const hadContent = this.#started;

    this.#endField();
    const fields = this.#fields;

    this.#fields = [];
    this.#started = false;
    this.#line += 1;
    this.#recordLine = this.#line;

    // A blank line is separation, not an empty record.
    if (!hadContent || (fields.length === 1 && fields[0] === "")) return null;

    return { line, fields };
  }
}
