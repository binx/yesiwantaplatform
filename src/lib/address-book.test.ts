import { describe, expect, it } from "vitest";
import type { CustomerAddress } from "@shared/account";
import { addressBookCsv, addressTitle, allTags, filterAddresses, formatBirthday } from "./address-book";
import { parseRecipientsCsv } from "./recipients-csv";

const entry = (over: Partial<CustomerAddress>): CustomerAddress => ({
  id: "a",
  name: "Maya Okafor",
  line1: "12 Elm St",
  line2: null,
  city: "Marfa",
  state: "TX",
  postalCode: "79843",
  country: "US",
  verifiedAt: null,
  label: null,
  tags: [],
  birthday: null,
  notes: null,
  source: "order",
  lastSentAt: null,
  ...over,
});

const book = [
  entry({ id: "1", label: "Mom", tags: ["family", "holiday"], birthday: "10-14" }),
  entry({ id: "2", name: "Sam Lee", city: "Boston", state: "MA", postalCode: "02134", tags: ["holiday"] }),
  entry({ id: "3", name: "Priya N", city: "Portland", state: "OR", postalCode: "97232", notes: "moved in 2025" }),
];

describe("the address book", () => {
  it("finds people by name, label, city, tag or note, and narrows by every chosen tag", () => {
    expect(filterAddresses(book, "mom", []).map((a) => a.id)).toEqual(["1"]);
    expect(filterAddresses(book, "bos", []).map((a) => a.id)).toEqual(["2"]);
    expect(filterAddresses(book, "moved", []).map((a) => a.id)).toEqual(["3"]);
    expect(filterAddresses(book, "", ["holiday"]).map((a) => a.id)).toEqual(["1", "2"]);
    expect(filterAddresses(book, "", ["holiday", "family"]).map((a) => a.id)).toEqual(["1"]);
    expect(filterAddresses(book, "sam", ["family"])).toEqual([]);
  });

  it("lists tags most used first", () => {
    expect(allTags(book)).toEqual(["holiday", "family"]);
  });

  it("writes birthdays with or without a year", () => {
    expect(formatBirthday("10-14", "en-US")).toBe("Oct 14");
    expect(formatBirthday("1985-10-14", "en-US")).toBe("Oct 14, 1985");
  });

  it("titles an entry by its label, then its printed name", () => {
    expect(addressTitle(book[0]!)).toBe("Mom · Maya Okafor");
    expect(addressTitle(book[1]!)).toBe("Sam Lee");
  });

  it("exports a CSV the importer reads straight back", () => {
    const csv = addressBookCsv(book);
    const { recipients, problems, ignored } = parseRecipientsCsv(csv);
    expect(problems).toEqual([]);
    expect(recipients.map((r) => r.name)).toEqual(["Maya Okafor", "Sam Lee", "Priya N"]);
    expect(recipients[1]?.postalCode).toBe("02134");
    expect(ignored).toEqual(["label", "tags", "birthday", "notes"]);
  });
});
