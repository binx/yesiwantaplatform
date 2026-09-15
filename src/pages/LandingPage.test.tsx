import { describe, expect, it } from "vitest";
import { storeSchema, defaultHero } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen } from "@/test-utils";
import { LandingPage } from "./LandingPage";

const withHero = (hero: Partial<typeof defaultHero>, priceCents = 140) =>
  storeSchema.parse({ ...demoStore, postcardPriceCents: priceCents, hero: { ...defaultHero, ...hero } });

describe("the landing page", () => {
  it("titles the page with the wordmark and a button to the designer", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}) });
    expect(screen.getByRole("heading", { level: 1, name: "postcards" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sold already/i })).toHaveAttribute("href", "/create");
  });

  it("prints the price from settings, never from prose", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}, 175) });
    expect(screen.getAllByText(/\$1\.75/).length).toBeGreaterThan(0);
  });

  it("renders every field a store has set", () => {
    renderWithProviders(<LandingPage />, { store: withHero({ heading: "Mail is nice", buttonLabel: "Start", buttonHref: "https://example.com/x" }) });
    expect(screen.getByRole("heading", { level: 1, name: "Mail is nice" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Start" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("apologises for the US-only reach until an international price is set", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}) });
    expect(screen.getByText(/Apologies to our international customers/)).toBeInTheDocument();
  });

  it("switches to the international answer once the store has a price for it", () => {
    const store = storeSchema.parse({ ...demoStore, internationalPostcardPriceCents: 250 });
    renderWithProviders(<LandingPage />, { store });
    expect(screen.getByText(/and to \d+ other countries — international cards cost \$2\.50/)).toBeInTheDocument();
  });
});
