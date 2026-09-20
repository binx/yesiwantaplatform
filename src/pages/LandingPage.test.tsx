import { describe, expect, it, vi } from "vitest";
import { storeSchema, defaultHero } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen } from "@/test-utils";
import { LandingPage } from "./LandingPage";

vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useArtists: () => ({ data: [], isPending: false }),
    useGallery: () => ({ data: { pages: [{ cards: [], nextCursor: null }] }, isPending: false }),
  };
});

vi.mock("@/lib/account", () => ({ useCustomer: () => ({ data: null }) }));

const withHero = (hero: Partial<typeof defaultHero>, minMonthlyPriceCents = 300) =>
  storeSchema.parse({ ...demoStore, pricing: { ...demoStore.pricing, minMonthlyPriceCents }, hero: { ...defaultHero, ...hero } });

describe("the landing page", () => {
  it("titles the page with the wordmark and a button to the artists", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}) });
    expect(screen.getByRole("heading", { level: 1, name: /yes.*i want a postcard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /YES I WANT A POSTCARD/ })).toHaveAttribute("href", "/artists");
  });

  it("prints the price floor from settings, never from prose", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}, 475) });
    expect(screen.getAllByText(/\$4\.75/).length).toBeGreaterThan(0);
  });

  it("renders every field the operator has set", () => {
    renderWithProviders(<LandingPage />, { store: withHero({ heading: "Mail is nice", buttonLabel: "Start", buttonHref: "https://example.com/x" }) });
    expect(screen.getByRole("heading", { level: 1, name: "Mail is nice" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Start" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("invites the first artist when nobody is live yet", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}) });
    expect(screen.getByText(/No artists have gone live yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Yours could be first/ })).toHaveAttribute("href", "/studio/new");
  });
});
