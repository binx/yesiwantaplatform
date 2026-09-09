import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "@/test-utils";
import type { Image } from "@shared/schema";
import { Carousel } from "./Carousel";
import styles from "./Carousel.module.css";

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

  // jsdom does no layout, so this can't see the grey void a mismatched image
  // pair left below a shorter slide — only that every slide carries the class
  // that gives all of them the same fixed frame regardless of what's in it.
  it("gives every slide the same frame class, whatever shape its image is", () => {
    renderWithProviders(<Carousel images={[front, side, detail]} productName="Tote" />);

    const slides = screen.getAllByRole("group", { name: /^\d+ of \d+$/ });
    expect(slides).toHaveLength(3);
    for (const slide of slides) {
      expect(slide).toHaveClass(styles.slide!);
    }
  });
});
