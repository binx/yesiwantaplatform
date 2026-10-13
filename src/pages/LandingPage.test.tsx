import { beforeEach, describe, expect, it, vi } from "vitest";
import { storeSchema, defaultHero } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen, within } from "@/test-utils";
import { LandingPage } from "./LandingPage";

vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useArtists: () => ({ data: [], isPending: false }),
    useGallery: () => ({ data: { pages: [{ editions: [], nextCursor: null }] }, isPending: false }),

  };
});

const customer = vi.hoisted(() => ({ data: null as null | { artistSlug: string | null } }));
vi.mock("@/lib/account", () => ({ useCustomer: () => customer }));

const withHero = (hero: Partial<typeof defaultHero>) => storeSchema.parse({ ...demoStore, hero: { ...defaultHero, ...hero } });

describe("the landing page", () => {
  beforeEach(() => {
    customer.data = null;
  });

  it("titles the page with the wordmark and a button to the artists", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}) });
    expect(screen.getByRole("heading", { level: 1, name: /yes.*i want a postcard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /YES I WANT A POSTCARD/ })).toHaveAttribute("href", "/artists");
  });

  it("renders every field the operator has set", () => {
    renderWithProviders(<LandingPage />, { store: withHero({ heading: "Mail is nice", buttonLabel: "Start", buttonHref: "https://example.com/x" }) });
    expect(screen.getByRole("heading", { level: 1, name: "Mail is nice" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Start" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("carries the site navigation itself, since the banner stays off the front page", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}) });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toContainElement(screen.getByRole("link", { name: "Artists" }));
    expect(nav).toContainElement(screen.getByRole("link", { name: "Gallery" }));
    expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/how-it-works");
    expect(within(nav).queryByRole("link", { name: "Your studio" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/account/login");
  });

  it("adds the studio to the navigation for someone who has one", () => {
    customer.data = { artistSlug: "rachel" };
    renderWithProviders(<LandingPage />, { store: withHero({}) });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/how-it-works");
    expect(within(nav).getByRole("link", { name: "Your studio" })).toHaveAttribute("href", "/studio");
  });

  it("invites the first artist when nobody is live yet", () => {
    renderWithProviders(<LandingPage />, { store: withHero({}) });
    expect(screen.getByText(/No artists have gone live yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Yours could be first/ })).toHaveAttribute("href", "/how-it-works");
  });
});
