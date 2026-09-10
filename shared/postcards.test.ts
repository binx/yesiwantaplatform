import { describe, expect, it } from "vitest";
import { addDaysIso, cropRect, defaultCrop, formatRecipient, reactionInputSchema, recipientSchema, replyCodeSchema, REACTIONS, stripEmoji, todayIso } from "./postcards";

describe("dates", () => {
  it("adds days as calendar arithmetic, across month and year ends, forwards and back", () => {
    expect(addDaysIso("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDaysIso("2026-10-05", -7)).toBe("2026-09-28");
    expect(addDaysIso("2027-01-03", -7)).toBe("2026-12-27");
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("formats today as YYYY-MM-DD in local time", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

});

describe("recipientSchema", () => {
  it("holds Lob's limits and normalises the state", () => {
    const parsed = recipientSchema.parse({ name: " Grandma ", line1: "1 Main St", line2: "", city: "Marfa", state: "tx", postalCode: "79843-1234", country: "US" });
    expect(parsed.name).toBe("Grandma");
    expect(parsed.state).toBe("TX");
    // "" is kept as "" by trim; the form turns blanks into null before parsing.
    expect(formatRecipient({ ...parsed, line2: null })).toBe("1 Main St, Marfa, TX 79843-1234");
  });

  it("asks for a state and a ZIP in the US, and for neither elsewhere", () => {
    const canada = recipientSchema.parse({ name: "Maya", line1: "12 Rue Ste-Catherine", line2: null, city: "Montréal", state: "Québec", postalCode: "H2X 1K4", country: "ca" });
    expect(canada.country).toBe("CA");
    expect(canada.state).toBe("Québec");
    const uk = recipientSchema.parse({ name: "Sam", line1: "10 Downing St", line2: null, city: "London", state: "", postalCode: "", country: "GB" });
    expect(uk.postalCode).toBe("");
    expect(recipientSchema.safeParse({ name: "A", line1: "1 Main St", line2: null, city: "A", state: "", postalCode: "", country: "US" }).success).toBe(false);
    expect(recipientSchema.safeParse({ name: "A", line1: "1 Main St", line2: null, city: "A", state: "", postalCode: "", country: "ZZ" }).success).toBe(false);
    expect(recipientSchema.parse({ name: "A", line1: "1 Main St", city: "A", state: "ca", postalCode: "90210" }).country).toBe("US");
  });

  it("names the country on an address abroad", () => {
    const canada = recipientSchema.parse({ name: "Maya", line1: "12 Rue Ste-Catherine", line2: null, city: "Montréal", state: "QC", postalCode: "H2X 1K4", country: "CA" });
    expect(formatRecipient(canada)).toBe("12 Rue Ste-Catherine, Montréal, QC H2X 1K4, Canada");
    expect(formatRecipient(canada, "fr")).toBe("12 Rue Ste-Catherine, Montréal, QC H2X 1K4, Canada");
    const uk = recipientSchema.parse({ name: "Sam", line1: "10 Downing St", line2: null, city: "London", state: "", postalCode: "", country: "GB" });
    expect(formatRecipient(uk)).toBe("10 Downing St, London, United Kingdom");
  });

  it("refuses what would not fit on the card", () => {
    expect(recipientSchema.safeParse({ name: "x".repeat(41), line1: "1 Main St", line2: null, city: "A", state: "CA", postalCode: "90210", country: "US" }).success).toBe(false);
    expect(recipientSchema.safeParse({ name: "A", line1: "1 Main St", line2: null, city: "A", state: "California", postalCode: "90210", country: "US" }).success).toBe(false);
    expect(recipientSchema.safeParse({ name: "A", line1: "1 Main St", line2: null, city: "A", state: "CA", postalCode: "9021" }).success).toBe(false);
  });
});

describe("stripEmoji", () => {
  it("removes pictographs and leaves punctuation and accents alone", () => {
    expect(stripEmoji("Café ☕️ & crêpes 🥐!")).toBe("Café  & crêpes !");
    expect(stripEmoji("Love, R ❤️")).toBe("Love, R ");
  });
});

describe("cropRect", () => {
  const source = { width: 4000, height: 1000 };
  const target = { width: 1875, height: 1275 };

  it("is the old centre crop at the default", () => {
    const rect = cropRect(source, target, defaultCrop);
    // Cover: the height is the limiting axis, so the source is scaled to 1275 tall.
    expect(rect.scale).toBeCloseTo(1.275);
    expect(rect.scaledHeight).toBeCloseTo(1275);
    expect(rect.top).toBe(0);
    // Half the horizontal overflow is hidden on the left.
    expect(rect.left).toBeCloseTo((5100 - 1875) / 2);
  });

  it("pins the edges at 0 and 1", () => {
    expect(cropRect(source, target, { ...defaultCrop, x: 0 }).left).toBe(0);
    expect(cropRect(source, target, { ...defaultCrop, x: 1 }).left).toBeCloseTo(5100 - 1875);
  });

  it("doubles the scale at zoom 2 and keeps the window inside the photo", () => {
    const rect = cropRect(source, target, { ...defaultCrop, zoom: 2 });
    expect(rect.scale).toBeCloseTo(2.55);
    expect(rect.top).toBeCloseTo((2550 - 1275) / 2);
    expect(rect.left + target.width).toBeLessThanOrEqual(rect.scaledWidth);
  });
});

describe("the reply code", () => {
  it("is eight characters from an alphabet with no lookalikes, and a reaction is one of the offered taps", () => {
    expect(replyCodeSchema.safeParse("AB7X3KQM").success).toBe(true);
    expect(replyCodeSchema.safeParse("AB7X3KQ0").success).toBe(false);
    expect(replyCodeSchema.safeParse("AB7X3KQ").success).toBe(false);
    expect(replyCodeSchema.parse(" ab7x3kqm ")).toBe("AB7X3KQM");
    expect(reactionInputSchema.parse({ emoji: REACTIONS[0] })).toEqual({ emoji: REACTIONS[0], note: null });
    expect(reactionInputSchema.safeParse({ emoji: "🙃" }).success).toBe(false);
    expect(reactionInputSchema.safeParse({ emoji: REACTIONS[0], note: "x".repeat(141) }).success).toBe(false);
  });
});
