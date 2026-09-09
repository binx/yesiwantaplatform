import { describe, expect, it } from "vitest";
import { storeSchema, defaultHero } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen } from "@/test-utils";
import { LandingPage } from "./LandingPage";

/**
 * The hero a merchant can edit.
 *
 * The two cases that matter are the ends of the range: a store that has set
 * none of this must render exactly what it rendered before the fields existed,
 * and a store that has set all of it must render what it was told. The middle
 * — one field set, the rest falling back — is where a naive `??` chain goes
 * wrong, so it is covered too.
 */

const withHero = (hero: Partial<typeof defaultHero>) =>
  storeSchema.parse({ ...demoStore, hero: { ...defaultHero, ...hero } });

describe("the landing page hero", () => {
  it("falls back to the store name, no paragraph, and Shop everything", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}) });

    expect(screen.getByRole("heading", { level: 1, name: "Beluga Demo" })).toBeInTheDocument();

    const button = screen.getByRole("link", { name: /shop everything/i });
    expect(button).toHaveAttribute("href", "/shop");

    // Not an empty paragraph: nothing at all.
    expect(document.querySelector("p[class*='heroText']")).toBeNull();
  });

  it("renders every field a store has set", () => {
    renderWithProviders(<LandingPage />, {
      store: withHero({
        heading: "Small runs, made to be used",
        text: "Everything here is made in batches of forty.",
        buttonLabel: "See the catalogue",
        buttonHref: "/collection/home-goods",
      }),
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "Small runs, made to be used" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Everything here is made in batches of forty.")).toBeInTheDocument();

    const button = screen.getByRole("link", { name: "See the catalogue" });
    expect(button).toHaveAttribute("href", "/collection/home-goods");
  });

  it("takes each field on its own, so one set field does not drag the others", () => {
    renderWithProviders(<LandingPage />, { store: withHero({ buttonLabel: "Browse" }) });

    expect(screen.getByRole("heading", { level: 1, name: "Beluga Demo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/shop");
  });

  it("leaves the store with an external link in a new tab, not the router", () => {
    // `Link` would try to resolve an absolute URL as an in-app route and land
    // on the 404 page, so an external target has to be a plain anchor.
    renderWithProviders(<LandingPage />, {
      store: withHero({ buttonHref: "https://example.com/lookbook", buttonLabel: "Lookbook" }),
    });

    const link = screen.getByRole("link", { name: "Lookbook" });
    expect(link).toHaveAttribute("href", "https://example.com/lookbook");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
