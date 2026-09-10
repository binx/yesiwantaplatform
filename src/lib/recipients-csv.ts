import { recipientSchema, type Recipient } from "@shared/postcards";
import { CsvStreamParser, unguardCsvField } from "@shared/csv";

/**
 * A recipient list as a CSV, parsed in the browser.
 *
 * v1 posted the file to the server and had `csvtojson` hand back rows; the
 * parser in shared/csv.ts is the same one the admin export writes with, so
 * there is nothing to round-trip through the API for.
 */
/** v1's column names, and this site's own, both accepted. */
const COLUMN_ALIASES: Record<string, keyof Recipient> = {
  name: "name",
  address_line1: "line1",
  line1: "line1",
  address: "line1",
  address_line2: "line2",
  line2: "line2",
  address_city: "city",
  city: "city",
  address_state: "state",
  state: "state",
  address_zip: "postalCode",
  zip: "postalCode",
  postal_code: "postalCode",
  postalcode: "postalCode",
};

export const SAMPLE_CSV =
  "name,address_line1,address_line2,address_city,address_state,address_zip\r\n" +
  'Postcard Recipient,123 Anywhere St.,Apt 2,Anytown,CA,90210\r\n';

export interface CsvProblem {
  line: number;
  message: string;
}

/** Parse a whole file into recipients, naming every row that failed. */
export function parseRecipientsCsv(text: string): { recipients: Recipient[]; problems: CsvProblem[] } {
  const parser = new CsvStreamParser();
  const records = [...parser.push(text), ...parser.end()];
  const header = records[0];
  if (!header) return { recipients: [], problems: [{ line: 1, message: "The file is empty." }] };

  const columns = header.fields.map((field) => COLUMN_ALIASES[field.trim().toLowerCase()] ?? null);
  const required: (keyof Recipient)[] = ["name", "line1", "city", "state", "postalCode"];
  const missing = required.filter((key) => !columns.includes(key));
  if (missing.length > 0) {
    return {
      recipients: [],
      problems: [{ line: 1, message: `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Download the sample for the expected names.` }],
    };
  }

  const recipients: Recipient[] = [];
  const problems: CsvProblem[] = [];

  for (const record of records.slice(1)) {
    const draft: Record<string, string | null> = { line2: null };
    columns.forEach((key, index) => {
      if (!key) return;
      const value = unguardCsvField(record.fields[index] ?? "").trim();
      draft[key] = key === "line2" && value === "" ? null : value;
    });

    const parsed = recipientSchema.safeParse(draft);
    if (parsed.success) recipients.push(parsed.data);
    else {
      const issue = parsed.error.issues[0];
      problems.push({ line: record.line, message: `${issue?.path.join(".") ?? "row"}: ${issue?.message ?? "invalid"}` });
    }
  }

  return { recipients, problems };
}

