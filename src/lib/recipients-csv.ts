import { recipientSchema, type Recipient } from "@shared/postcards";
import { CsvStreamParser, detectCsvDelimiter, stripCsvBom, unguardCsvField } from "@shared/csv";
import { COUNTRY_CODES, countryName, isCountryCode } from "@shared/countries";

/**
 * A recipient list as a CSV, parsed in the browser.
 *
 * v1 posted the file to the server and had `csvtojson` hand back rows; the
 * parser in shared/csv.ts is the same one the admin export writes with, so
 * there is nothing to round-trip through the API for.
 *
 * Headers are matched loosely, because the file is whatever a spreadsheet
 * exported: "Street Address", "Zip Code", "First Name" + "Last Name", a
 * byte-order mark in front of the first one, semicolons in a European
 * locale. A header that matches nothing is ignored, not fatal; a row that
 * fails is reported with its line number and handed back so it can be fixed
 * by hand, while the rows that passed are imported.
 */

/** The fields a column can feed. `firstName` + `lastName` join into `name`. */
type Target = keyof Recipient | "firstName" | "lastName";

/** Keyed on the header with case, spaces and punctuation removed. */
const ALIASES: Record<string, Target> = {
  name: "name",
  fullname: "name",
  recipient: "name",
  recipientname: "name",
  to: "name",
  firstname: "firstName",
  givenname: "firstName",
  lastname: "lastName",
  surname: "lastName",
  familyname: "lastName",
  address: "line1",
  address1: "line1",
  addressline1: "line1",
  street: "line1",
  streetaddress: "line1",
  street1: "line1",
  line1: "line1",
  address2: "line2",
  addressline2: "line2",
  apt: "line2",
  apartment: "line2",
  suite: "line2",
  unit: "line2",
  street2: "line2",
  line2: "line2",
  city: "city",
  town: "city",
  addresscity: "city",
  state: "state",
  province: "state",
  region: "state",
  stateprovince: "state",
  addressstate: "state",
  zip: "postalCode",
  zipcode: "postalCode",
  postalcode: "postalCode",
  postcode: "postalCode",
  postal: "postalCode",
  addresszip: "postalCode",
  country: "country",
  countrycode: "country",
};

/** What each field is called when the mapping is shown back to the buyer. */
const FIELD_LABELS: Record<Target, string> = {
  name: "the name",
  firstName: "the first name",
  lastName: "the last name",
  line1: "the street",
  line2: "the apartment or suite",
  city: "the city",
  state: "the state",
  postalCode: "the ZIP or postal code",
  country: "the country",
};

export const SAMPLE_CSV =
  "name,address_line1,address_line2,address_city,address_state,address_zip,country\r\n" +
  'Postcard Recipient,123 Anywhere St.,Apt 2,Anytown,CA,90210,US\r\n';

export interface CsvProblem {
  line: number;
  message: string;
  /** What the row held, so the form can be filled from it and the mistake fixed by hand. */
  draft: Recipient;
}

export interface CsvMapping {
  header: string;
  field: Target;
  label: string;
}

export interface CsvResult {
  recipients: Recipient[];
  problems: CsvProblem[];
  /** Which column fed which field, in file order. */
  mapping: CsvMapping[];
  /** Headers that matched nothing and were left out. */
  ignored: string[];
  /** The first few rows as they were read, for the preview. */
  preview: Recipient[];
}

const normaliseHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A message a person can act on, for the mistakes a spreadsheet makes on its own. */
function explain(field: string, message: string, draft: Recipient): string {
  if (field === "postalCode" && /^\d{4}$/.test(draft.postalCode)) {
    return "postalCode: ZIP has 4 digits — Excel may have dropped a leading zero.";
  }
  return `${field}: ${message}`;
}

/** Parse a whole file into recipients, naming every row that failed and what each column was read as. */
export function parseRecipientsCsv(rawText: string): CsvResult {
  const text = stripCsvBom(rawText);
  const parser = new CsvStreamParser({ delimiter: detectCsvDelimiter(text) });
  const records = [...parser.push(text), ...parser.end()];
  const empty: CsvResult = { recipients: [], problems: [], mapping: [], ignored: [], preview: [] };

  const header = records[0];
  if (!header) return { ...empty, problems: [{ line: 1, message: "The file is empty.", draft: blankDraft() }] };

  const columns: (Target | null)[] = [];
  const mapping: CsvMapping[] = [];
  const ignored: string[] = [];
  for (const raw of header.fields) {
    const label = raw.trim();
    const target = ALIASES[normaliseHeader(label)] ?? null;
    columns.push(target);
    if (target) mapping.push({ header: label, field: target, label: FIELD_LABELS[target] });
    else if (label !== "") ignored.push(label);
  }

  const has = (target: Target) => columns.includes(target);
  const required: { key: Target; satisfied: boolean }[] = [
    { key: "name", satisfied: has("name") || (has("firstName") && has("lastName")) || has("firstName") },
    { key: "line1", satisfied: has("line1") },
    { key: "city", satisfied: has("city") },
    { key: "state", satisfied: has("state") },
    { key: "postalCode", satisfied: has("postalCode") },
  ];
  const missing = required.filter((r) => !r.satisfied).map((r) => r.key);
  if (missing.length > 0) {
    return {
      ...empty,
      mapping,
      ignored,
      problems: [
        {
          line: 1,
          message: `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Download the sample for the expected names.`,
          draft: blankDraft(),
        },
      ],
    };
  }

  const recipients: Recipient[] = [];
  const problems: CsvProblem[] = [];

  for (const record of records.slice(1)) {
    const draft = blankDraft();
    let firstName = "";
    let lastName = "";
    columns.forEach((target, index) => {
      if (!target) return;
      const value = unguardCsvField(record.fields[index] ?? "").trim();
      if (target === "firstName") firstName = value;
      else if (target === "lastName") lastName = value;
      else if (target === "line2") draft.line2 = value === "" ? null : value;
      else if (target === "country") draft.country = value === "" ? "US" : countryCode(value);
      else draft[target] = value;
    });
    if (!has("name")) draft.name = [firstName, lastName].filter(Boolean).join(" ");

    const parsed = recipientSchema.safeParse(draft);
    if (parsed.success) recipients.push(parsed.data);
    else {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join(".") ?? "row";
      problems.push({ line: record.line, message: explain(field, issue?.message ?? "invalid", draft), draft });
    }
  }

  return { recipients, problems, mapping, ignored, preview: recipients.slice(0, 3) };
}

function blankDraft(): Recipient {
  return { name: "", line1: "", line2: null, city: "", state: "", postalCode: "", country: "US" };
}

/** "Canada", "canada" or "CA" → "CA". A name that matches nothing is left for the schema to refuse. */
function countryCode(value: string): string {
  const upper = value.trim().toUpperCase();
  if (isCountryCode(upper)) return upper;
  const wanted = value.trim().toLowerCase();
  if (wanted === "usa" || wanted === "united states" || wanted === "united states of america") return "US";
  if (wanted === "uk" || wanted === "united kingdom" || wanted === "great britain") return "GB";
  const match = COUNTRY_CODES.find((code) => countryName(code, "en").toLowerCase() === wanted);
  return match ?? upper;
}
