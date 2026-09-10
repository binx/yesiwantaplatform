import { describe, expect, it } from "vitest";
import { parseRecipientsCsv } from "./recipients-csv";

/** The CSV path: v1's column names, what spreadsheets export, and rows that name their own problem. */
describe("parseRecipientsCsv", () => {
  it("reads v1's column names and this site's own", () => {
    const { recipients, problems } = parseRecipientsCsv(
      "name,address_line1,address_line2,address_city,address_state,address_zip\r\nGrandma,1 Main St,,Marfa,tx,79843\r\n",
    );
    expect(problems).toEqual([]);
    expect(recipients).toEqual([{ name: "Grandma", line1: "1 Main St", line2: null, city: "Marfa", state: "TX", postalCode: "79843", country: "US" }]);

    const alt = parseRecipientsCsv("Name,Line1,City,State,Zip\nA,1 St,B,CA,90210\n");
    expect(alt.recipients).toHaveLength(1);
  });

  it("reads what Excel exports: a byte-order mark, spaced and capitalised headers, first and last names", () => {
    const text = "﻿First Name,Last Name,Street Address,Apt,City,State,Zip Code,Email\nMaya,Okafor,12 Elm St,,Marfa,TX,79843,maya@example.com\n";
    const { recipients, problems, mapping, ignored } = parseRecipientsCsv(text);
    expect(problems).toEqual([]);
    expect(recipients).toEqual([{ name: "Maya Okafor", line1: "12 Elm St", line2: null, city: "Marfa", state: "TX", postalCode: "79843", country: "US" }]);
    expect(mapping.map((m) => [m.header, m.field])).toEqual([
      ["First Name", "firstName"],
      ["Last Name", "lastName"],
      ["Street Address", "line1"],
      ["Apt", "line2"],
      ["City", "city"],
      ["State", "state"],
      ["Zip Code", "postalCode"],
    ]);
    expect(ignored).toEqual(["Email"]);
  });

  it("reads a semicolon-delimited file", () => {
    const { recipients, problems } = parseRecipientsCsv("Name;Street;City;State;Postal Code\nA;1 St;B;CA;90210\n");
    expect(problems).toEqual([]);
    expect(recipients[0]?.postalCode).toBe("90210");
  });

  it("imports the good rows and hands back the bad ones with what they held", () => {
    const { recipients, problems, preview } = parseRecipientsCsv(
      "name,address_line1,address_city,address_state,address_zip\nA,1 St,B,CA,90210\nB,2 St,C,ZZ,90210\nC,3 St,D,CA,90211\n",
    );
    expect(recipients).toHaveLength(2);
    expect(preview).toHaveLength(2);
    expect(problems).toEqual([
      { line: 3, message: expect.stringContaining("state"), draft: { name: "B", line1: "2 St", line2: null, city: "C", state: "ZZ", postalCode: "90210", country: "US" } },
    ]);
  });

  it("maps a full state name to its code", () => {
    const { recipients, problems } = parseRecipientsCsv("name,address_line1,address_city,address_state,address_zip\nA,1 St,B,California,90210\n");
    expect(problems).toEqual([]);
    expect(recipients).toEqual([{ name: "A", line1: "1 St", line2: null, city: "B", state: "CA", postalCode: "90210", country: "US" }]);
  });

  it("says when Excel probably ate a leading zero", () => {
    const { problems } = parseRecipientsCsv("name,address_line1,address_city,address_state,address_zip\nA,1 St,Boston,MA,2134\n");
    expect(problems[0]?.message).toMatch(/leading zero/);
  });

  it("reads a country column, by code or by name, and defaults to the US", () => {
    const { recipients, problems } = parseRecipientsCsv(
      "name,street,city,state,postal code,country\nA,1 St,B,CA,90210,\nMaya,12 Rue Ste-Catherine,Montréal,QC,H2X 1K4,Canada\nSam,10 Downing St,London,,SW1A 2AA,uk\n",
    );
    expect(problems).toEqual([]);
    expect(recipients.map((r) => r.country)).toEqual(["US", "CA", "GB"]);
    expect(recipients[1]?.postalCode).toBe("H2X 1K4");
  });

  it("refuses a country it does not know", () => {
    const { problems } = parseRecipientsCsv("name,street,city,state,zip,country\nA,1 St,B,CA,90210,Narnia\n");
    expect(problems[0]?.message).toMatch(/country/);
  });

  it("refuses a file missing a required column, naming it", () => {
    const { problems, recipients } = parseRecipientsCsv("name,city\nA,B\n");
    expect(recipients).toEqual([]);
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.message).toMatch(/Missing columns: line1, state, postalCode/);
  });

  it("names an empty file", () => {
    expect(parseRecipientsCsv("").problems[0]?.message).toMatch(/empty/);
  });
});
