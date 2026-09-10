import { describe, expect, it } from "vitest";
import { parseRecipientsCsv } from "./recipients-csv";

/** The CSV path: v1's column names, blank second lines, and a row that names its own problem. */
describe("parseRecipientsCsv", () => {
  it("reads v1's column names and this site's own", () => {
    const { recipients, problems } = parseRecipientsCsv(
      "name,address_line1,address_line2,address_city,address_state,address_zip\r\nGrandma,1 Main St,,Marfa,tx,79843\r\n",
    );
    expect(problems).toEqual([]);
    expect(recipients).toEqual([{ name: "Grandma", line1: "1 Main St", line2: null, city: "Marfa", state: "TX", postalCode: "79843" }]);

    const alt = parseRecipientsCsv("Name,Line1,City,State,Zip\nA,1 St,B,CA,90210\n");
    expect(alt.recipients).toHaveLength(1);
  });

  it("names the line and the field of a bad row", () => {
    const { recipients, problems } = parseRecipientsCsv(
      "name,address_line1,address_city,address_state,address_zip\nA,1 St,B,CA,90210\nB,2 St,C,California,90210\n",
    );
    expect(recipients).toHaveLength(1);
    expect(problems).toEqual([{ line: 3, message: expect.stringContaining("state") }]);
  });

  it("refuses a file missing a required column", () => {
    const { problems } = parseRecipientsCsv("name,city\nA,B\n");
    expect(problems[0]?.message).toMatch(/Missing column/);
  });
});
