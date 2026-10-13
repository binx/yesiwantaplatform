import { describe, expect, it } from "vitest";
import { artistLinkLabel, artistLinkSchema, artistSlugSchema, defaultStartDate, editionSchedule, editionSizeSchema, instagramHandle, mailDaysFor, startDateProblem, withScheme } from "./platform";
import { artistShareCents, cardGrossCents, platformFeeCentsFor } from "./schema";

describe("the artist's share", () => {
  it("is the price less printing and the fee, never below zero", () => {
    const pricing = { printCostCents: 120, platformFeePercent: 30 };
    expect(platformFeeCentsFor(500, pricing)).toBe(150);
    expect(platformFeeCentsFor(205, pricing)).toBe(61);
    expect(artistShareCents(500, pricing)).toBe(230);
    expect(artistShareCents(171, pricing)).toBe(0);
    expect(artistShareCents(100, pricing)).toBe(0);
  });
});

describe("a card's part of the price", () => {
  it("splits evenly, with the odd cents on card 1, and always adds up", () => {
    expect([1, 2, 3, 4, 5, 6].map((p) => cardGrossCents(3000, 6, p))).toEqual([500, 500, 500, 500, 500, 500]);
    expect(cardGrossCents(2500, 12, 1)).toBe(208 + 4);
    expect(cardGrossCents(2500, 12, 2)).toBe(208);
    for (const [price, count] of [[2500, 12], [1999, 6], [50, 6]] as const) {
      const parts = Array.from({ length: count }, (_, i) => cardGrossCents(price, count, i + 1));
      expect(parts.reduce((a, b) => a + b, 0)).toBe(price);
    }
  });
});

describe("an artist's links", () => {
  it("reads an Instagram username out of whatever was typed", () => {
    for (const typed of ["rachel.binx", "@rachel.binx", "instagram.com/rachel.binx", "https://www.instagram.com/rachel.binx/", "https://instagram.com/rachel.binx?hl=en"]) {
      expect(instagramHandle(typed)).toBe("rachel.binx");
    }
  });

  it("supplies a missing scheme and leaves a full address alone", () => {
    expect(withScheme("rachel.example")).toBe("https://rachel.example");
    expect(withScheme(" http://rachel.example ")).toBe("http://rachel.example");
    expect(withScheme("")).toBe("");
  });

  it("stores a kind, reading links from before kinds as custom", () => {
    expect(artistLinkSchema.parse({ label: "Shop", url: "https://shop.example" })).toEqual({ kind: "custom", label: "Shop", url: "https://shop.example" });
    expect(artistLinkSchema.safeParse({ kind: "instagram", url: "https://instagram.com/rachel" }).success).toBe(true);
    expect(artistLinkSchema.safeParse({ kind: "instagram", url: "https://example.com/rachel" }).success).toBe(false);
    expect(artistLinkSchema.safeParse({ kind: "instagram", url: "https://instagram.com/not a name" }).success).toBe(false);
    expect(artistLinkSchema.safeParse({ kind: "website", url: "rachel.example" }).success).toBe(false);
  });

  it("is labelled by its label, its username, or its host", () => {
    expect(artistLinkLabel({ kind: "custom", label: "Shop", url: "https://shop.example" })).toBe("Shop");
    expect(artistLinkLabel({ kind: "instagram", label: "", url: "https://instagram.com/rachel.binx" })).toBe("@rachel.binx");
    expect(artistLinkLabel({ kind: "website", label: "", url: "https://www.rachel.example/about" })).toBe("rachel.example");
  });
});

describe("an edition's schedule", () => {
  it("is six or twelve cards, nothing else", () => {
    expect(editionSizeSchema.safeParse(6).success).toBe(true);
    expect(editionSizeSchema.safeParse(12).success).toBe(true);
    expect(editionSizeSchema.safeParse(8).success).toBe(false);
  });

  it("lands monthly on the start day, across the year's end", () => {
    expect(editionSchedule("2026-11-07", 6, "monthly")).toEqual(["2026-11-07", "2026-12-07", "2027-01-07", "2027-02-07", "2027-03-07", "2027-04-07"]);
  });

  it("lands twice a month fourteen days apart, inside the 1st to the 28th", () => {
    expect(mailDaysFor("twice_monthly", 1)).toEqual([1, 15]);
    expect(mailDaysFor("twice_monthly", 20)).toEqual([6, 20]);
    expect(editionSchedule("2026-11-01", 6, "twice_monthly")).toEqual(["2026-11-01", "2026-11-15", "2026-12-01", "2026-12-15", "2027-01-01", "2027-01-15"]);
    // Starting on the later of the two days: the earlier one comes next month.
    expect(editionSchedule("2026-11-20", 4, "twice_monthly")).toEqual(["2026-11-20", "2026-12-06", "2026-12-20", "2027-01-06"]);
    expect(editionSchedule("2026-11-01", 12, "twice_monthly")).toHaveLength(12);
  });

  it("starts on the next 1st or 15th unless the collector picks a day", () => {
    expect(defaultStartDate("2026-10-12")).toBe("2026-10-15");
    expect(defaultStartDate("2026-10-15")).toBe("2026-11-01");
    expect(defaultStartDate("2026-12-20")).toBe("2027-01-01");
  });

  it("refuses a start day that has passed, is too far off, or some months lack", () => {
    expect(startDateProblem("2026-10-13", "2026-10-12")).toBeNull();
    expect(startDateProblem("2026-10-12", "2026-10-12")).toMatch(/after today/);
    expect(startDateProblem("2027-03-01", "2026-10-12")).toMatch(/within the next/);
    expect(startDateProblem("2026-10-30", "2026-10-12")).toMatch(/1st to the 28th/);
  });
});

describe("an artist's address", () => {
  it("refuses the routes the site already owns, and anything too short", () => {
    expect(artistSlugSchema.safeParse("rachel").success).toBe(true);
    expect(artistSlugSchema.safeParse("admin").success).toBe(false);
    expect(artistSlugSchema.safeParse("gallery").success).toBe(false);
    expect(artistSlugSchema.safeParse("me").success).toBe(false);
    expect(artistSlugSchema.safeParse("Not A Slug").success).toBe(false);
  });
});
