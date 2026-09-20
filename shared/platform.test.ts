import { describe, expect, it } from "vitest";
import { artistSlugSchema, nextMailDate, periodOf } from "./platform";
import { artistShareCents } from "./schema";

describe("the artist's share", () => {
  it("is the price less printing and the fee, never below zero", () => {
    const pricing = { printCostCents: 120, platformFeeCents: 60 };
    expect(artistShareCents(500, pricing)).toBe(320);
    expect(artistShareCents(180, pricing)).toBe(0);
    expect(artistShareCents(100, pricing)).toBe(0);
  });
});

describe("the next mail date", () => {
  it("is the send day in the first month not already taken, never in the past", () => {
    expect(nextMailDate(15, [], "2026-09-01")).toBe("2026-09-15");
    expect(nextMailDate(15, [], "2026-09-16")).toBe("2026-10-15");
    expect(nextMailDate(15, ["2026-09-15"], "2026-09-01")).toBe("2026-10-15");
    expect(nextMailDate(15, ["2026-09-03", "2026-10-20"], "2026-09-01")).toBe("2026-11-15");
    expect(nextMailDate(1, [], "2026-12-02")).toBe("2027-01-01");
    expect(periodOf("2026-09-14")).toBe("2026-09");
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
