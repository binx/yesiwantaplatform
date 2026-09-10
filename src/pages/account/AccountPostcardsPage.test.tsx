import { describe, expect, it } from "vitest";
import { summariseDesign } from "@shared/gallery";
import { renderWithProviders, screen } from "@/test-utils";
import { DesignCard } from "./AccountPostcardsPage";

/** A design card says what happened to the design in one line, and links to it. */
const base = {
  id: "d1",
  orientation: "portrait" as const,
  thumbnail: { path: "designs/d1/thumb.webp", width: 408, height: 600, alt: "", widths: [] },
  back: { text: "Wish you were here\nSecond line", valediction: "", fontName: "Sacramento", fontSize: 24, fontColor: "#000000" },
  createdAt: 0,
  ordered: true,
  originId: null,
  canSendAgain: true,
  postcards: { total: 3, scheduled: 1, sent: 2, delivered: 1, error: 0, cancelled: 0, firstMailDate: "2026-09-14", lastMailDate: "2026-09-21" },
};

describe("the gallery card", () => {
  it("shows the first line of the message and a summary, and links to the design", () => {
    renderWithProviders(<DesignCard design={base} />);
    expect(screen.getByText("Wish you were here")).toBeInTheDocument();
    expect(screen.getByText("2 sent, 1 delivered · 1 scheduled")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/account/postcards/d1");
  });

  it("summarises a draft, a card needing attention, and a plain batch", () => {
    expect(summariseDesign({ ordered: false, postcards: base.postcards })).toBe("Draft");
    expect(summariseDesign({ ordered: true, postcards: { ...base.postcards, sent: 0, delivered: 0, scheduled: 0, error: 1 } })).toBe("1 needs attention");
    expect(summariseDesign({ ordered: true, postcards: { ...base.postcards, sent: 0, delivered: 0, scheduled: 0, error: 0, cancelled: 3 } })).toBe("3 postcards");
  });
});
