import { describe, expect, it } from "vitest";
import { addDaysIso, businessDaysBeforeIso, cropRect, defaultCrop, formatRecipient, recipientSchema, stripEmoji, todayIso } from "./postcards";

describe("dates", () => {
  it("adds days as calendar arithmetic, across month and year ends", () => {
    expect(addDaysIso("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("formats today as YYYY-MM-DD in local time", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("counts business days backwards, skipping weekends and crossing month and year ends", () => {
    // Monday 14 Sep 2026: six weekdays earlier is Friday 4 Sep, over one weekend.
    expect(businessDaysBeforeIso("2026-09-14", 6)).toBe("2026-09-04");
    // Saturday 19 Sep: one weekday earlier is Friday 18 Sep.
    expect(businessDaysBeforeIso("2026-09-19", 1)).toBe("2026-09-18");
    // Monday 2 Nov: two weekdays earlier is Thursday 29 Oct, over the weekend and the month end.
    expect(businessDaysBeforeIso("2026-11-02", 2)).toBe("2026-10-29");
    // Monday 4 Jan 2027: three weekdays earlier is Wednesday 30 Dec 2026 (Friday 1 Jan counts; no holidays).
    expect(businessDaysBeforeIso("2027-01-04", 3)).toBe("2026-12-30");
    expect(businessDaysBeforeIso("2026-09-14", 0)).toBe("2026-09-14");
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
