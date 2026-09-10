import { describe, expect, it } from "vitest";
import { addDaysIso, formatRecipient, recipientSchema, stripEmoji, todayIso } from "./postcards";

describe("dates", () => {
  it("adds days as calendar arithmetic, across month and year ends", () => {
    expect(addDaysIso("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("formats today as YYYY-MM-DD in local time", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("recipientSchema", () => {
  it("holds Lob's limits and normalises the state", () => {
    const parsed = recipientSchema.parse({ name: " Grandma ", line1: "1 Main St", line2: "", city: "Marfa", state: "tx", postalCode: "79843-1234" });
    expect(parsed.name).toBe("Grandma");
    expect(parsed.state).toBe("TX");
    // "" is kept as "" by trim; the form turns blanks into null before parsing.
    expect(formatRecipient({ ...parsed, line2: null })).toBe("1 Main St, Marfa, TX 79843-1234");
  });

  it("refuses what would not fit on the card", () => {
    expect(recipientSchema.safeParse({ name: "x".repeat(41), line1: "1 Main St", line2: null, city: "A", state: "CA", postalCode: "90210" }).success).toBe(false);
    expect(recipientSchema.safeParse({ name: "A", line1: "1 Main St", line2: null, city: "A", state: "California", postalCode: "90210" }).success).toBe(false);
    expect(recipientSchema.safeParse({ name: "A", line1: "1 Main St", line2: null, city: "A", state: "CA", postalCode: "9021" }).success).toBe(false);
  });
});

describe("stripEmoji", () => {
  it("removes pictographs and leaves punctuation and accents alone", () => {
    expect(stripEmoji("Café ☕️ & crêpes 🥐!")).toBe("Café  & crêpes !");
    expect(stripEmoji("Love, R ❤️")).toBe("Love, R ");
  });
});
