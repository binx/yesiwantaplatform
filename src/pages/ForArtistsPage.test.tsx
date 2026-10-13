import { describe, expect, it, vi } from "vitest";
import { storeSchema } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen } from "@/test-utils";
import { ForArtistsPage } from "./ForArtistsPage";

const customer = vi.hoisted(() => ({ data: null as null | { artistSlug: string | null } }));
vi.mock("@/lib/account", () => ({ useCustomer: () => customer }));

const withPricing = (printCostCents: number, platformFeePercent: number, minCardPriceCents: number) =>
  storeSchema.parse({ ...demoStore, pricing: { printCostCents, platformFeePercent, minCardPriceCents } });

describe("the how-it-works page", () => {
  it("works an example for each edition size from settings: the price, printing, the fee and the remainder", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(130, 30, 350) });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Put your pictures in the mail");
    expect(screen.getByRole("heading", { level: 2, name: "Example pricing" })).toBeInTheDocument();
    // Six cards at $5.00: $7.80 of printing, 30% of each $5.00 is $1.50 so $9.00 of fee, $13.20 kept — by the shared formulas, not by hand.
    const six = screen.getByLabelText(/What a \$30\.00 edition of 6 pays/);
    expect(six).toHaveTextContent("$30.00");
    expect(six).toHaveTextContent("$7.80");
    expect(six).toHaveTextContent("Platform fee (30%)");
    expect(six).toHaveTextContent("$9.00");
    expect(six).toHaveTextContent("$13.20");
    // Twelve cards at $5.00: twice everything.
    const twelve = screen.getByLabelText(/What a \$60\.00 edition of 12 pays/);
    expect(twelve).toHaveTextContent("$15.60");
    expect(twelve).toHaveTextContent("$18.00");
    expect(twelve).toHaveTextContent("$26.40");
    expect(screen.queryByText(/of the price/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stripe/)).not.toBeInTheDocument();
  });

  it("uses the floor as the example's per-card price when it is above five dollars", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 30, 800) });
    // $8.00 a card: $1.20 printing and $2.40 fee off each, $4.40 kept, $26.40 for six.
    expect(screen.getByLabelText(/What a \$48\.00 edition of 6 pays/)).toHaveTextContent("$26.40");
  });

  it("tells the story in three steps, without the back of the card or the draft", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 30, 300) });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 3, name: "Set up your studio" })).toBeInTheDocument();
    expect(screen.queryByText(/on the back/)).not.toBeInTheDocument();
    expect(screen.queryByText(/draft/)).not.toBeInTheDocument();
    expect(screen.queryByText("For artists")).not.toBeInTheDocument();
  });

  it("offers a visitor the studio twice, Get started above the steps and Open your studio at the end, with no warning about the sign-in to come", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 30, 300) });
    expect(screen.getByRole("link", { name: /Get started/ })).toHaveAttribute("href", "/studio/new");
    expect(screen.getByRole("link", { name: /^Open your studio$/ })).toHaveAttribute("href", "/studio/new");
    expect(screen.queryByText(/sign in or create an account/)).not.toBeInTheDocument();
  });

  it("sends an artist to their studio instead, both times, without remarking that they have one", () => {
    customer.data = { artistSlug: "rachel" };
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 30, 300) });
    const links = screen.getAllByRole("link", { name: /Go to your studio/ });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/studio");
    expect(screen.queryByRole("link", { name: /Open your studio/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/already have one/)).not.toBeInTheDocument();
  });
});
