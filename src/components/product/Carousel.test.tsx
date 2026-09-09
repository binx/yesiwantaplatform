import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "@/test-utils";
import type { Image } from "@shared/schema";
import { Carousel } from "./Carousel";

function image(path: string, alt: string): Image {
  return { path, width: 900, height: 1200, alt, widths: [], variantId: null };
}

const front = image("front.png", "Front");
const side = image("side.png", "Side");
const detail = image("detail.png", "Detail");

describe("Carousel", () => {
  it("shows the images in the given order, with the first one active", () => {
    renderWithProviders(<Carousel images={[front, side, detail]} productName="Tote" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Show image 1: Front",
      "Show image 2: Side",
      "Show image 3: Detail",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("reorders when the image order changes — a different variant was selected", () => {
    const { rerender } = renderWithProviders(
      <Carousel images={[front, side, detail]} productName="Tote" />,
    );

    // A variant switch reorders the same three images without changing how
    // many there are — exactly what `orderImagesForVariant` produces.
    rerender(<Carousel images={[side, front, detail]} productName="Tote" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Show image 1: Side",
      "Show image 2: Front",
      "Show image 3: Detail",
    ]);

    // The active slide resets to the new first image rather than staying on
    // whatever index a previous swipe or selection left it at.
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Image 1 of 3")).toBeInTheDocument();
  });
});
