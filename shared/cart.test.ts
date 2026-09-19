import { describe, expect, it } from "vitest";
import { cartLineSchema, countPostcards, countPostcardsByDestination, lineRecipientCount } from "./cart.js";

const us = { name: "A", line1: "1 St", line2: null, city: "B", state: "CA", postalCode: "90210", country: "US" };
const ca = { ...us, name: "C", state: "QC", postalCode: "H2X 1K4", country: "CA" };

describe("counting a cart", () => {
  it("multiplies designs by recipients, and splits the product by destination", () => {
    const lines = [
      { designs: [{ designId: "a", mailDate: "2026-09-14" }, { designId: "b", mailDate: "2026-09-21" }], recipients: [us, ca, ca] },
      { designs: [{ designId: "c", mailDate: "2026-09-14" }], recipients: [us] },
    ];
    expect(countPostcards(lines)).toBe(7);
    expect(countPostcardsByDestination(lines)).toEqual({ domestic: 3, international: 4 });
    expect(countPostcardsByDestination([])).toEqual({ domestic: 0, international: 0 });
  });

  it("counts a reply as one card per design, to a recipient the cart does not name", () => {
    const reply = { designs: [{ designId: "a", mailDate: "2026-09-14" }, { designId: "b", mailDate: "2026-09-21" }], recipients: [], replyTo: "AB7X3KQM" };
    expect(lineRecipientCount(reply)).toBe(1);
    expect(countPostcards([reply])).toBe(2);
    expect(countPostcardsByDestination([reply])).toEqual({ domestic: 2, international: 0 });
  });
});

describe("a cart line", () => {
  it("needs either recipients or a card to reply to — not both, not neither", () => {
    const plain = cartLineSchema.parse({ designs: [{ designId: "a", mailDate: "2026-09-14" }], recipients: [us] });
    expect(plain).toMatchObject({ replyTo: null, replyToName: null });
    expect(cartLineSchema.parse({ designs: [{ designId: "a", mailDate: "2026-09-14" }], recipients: [], replyTo: "AB7X3KQM", replyToName: "Rachel" }).replyTo).toBe("AB7X3KQM");
    expect(cartLineSchema.safeParse({ designs: [{ designId: "a", mailDate: "2026-09-14" }], recipients: [] }).success).toBe(false);
    expect(cartLineSchema.safeParse({ designs: [{ designId: "a", mailDate: "2026-09-14" }], recipients: [us], replyTo: "AB7X3KQM" }).success).toBe(false);
    expect(cartLineSchema.parse({ designs: [{ designId: "a", mailDate: "2026-09-14" }], recipients: [], replyTo: "ab7x3kqm" }).replyTo).toBe("AB7X3KQM");
    expect(cartLineSchema.safeParse({ designs: [{ designId: "a", mailDate: "2026-09-14" }], recipients: [], replyTo: "AB7X3KQ0" }).success).toBe(false);
  });
});
