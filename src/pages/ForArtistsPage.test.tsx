import { describe, expect, it, vi } from "vitest";
import { storeSchema } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen } from "@/test-utils";
import { ForArtistsPage } from "./ForArtistsPage";

const customer = vi.hoisted(() => ({ data: null as null | { artistSlug: string | null } }));
vi.mock("@/lib/account", () => ({ useCustomer: () => customer }));

const withPricing = (printCostCents: number, platformFeeCents: number, minCardPriceCents: number) =>
  storeSchema.parse({ ...demoStore, pricing: { printCostCents, platformFeeCents, minCardPriceCents } });

describe("the open-a-studio page", () => {
  it("works the example edition from settings, as one price, one cost and one remainder", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(130, 45, 350) });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Put your pictures in the post");
    expect(screen.getByRole("heading", { level: 2, name: "Example pricing" })).toBeInTheDocument();
    // Six cards at $5.00: $1.75 off each, so $10.50 off the set and $19.50 kept, by cardGrossCents and artistShareCents, not by hand.
    const example = screen.getByLabelText(/What a \$30\.00 edition of 6 pays/);
    expect(example).toHaveTextContent("$30.00");
    expect(example).toHaveTextContent("$10.50");
    expect(example).toHaveTextContent("$19.50");
    expect(example).toHaveTextContent("65% of the price");
    // The split between printing and the fee is not the visitor's business, and neither is the processor.
    expect(screen.queryByText(/\$1\.30/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.45/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stripe/)).not.toBeInTheDocument();
  });

  it("uses the floor as the example's per-card price when it is above five dollars", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 800) });
    expect(screen.getByLabelText(/What a \$48\.00 edition of 6 pays/)).toHaveTextContent("$37.20");
  });

  it("tells the story in three steps, without the back of the card or the draft", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 300) });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/on the back/)).not.toBeInTheDocument();
    expect(screen.queryByText(/draft/)).not.toBeInTheDocument();
    expect(screen.queryByText("For artists")).not.toBeInTheDocument();
  });

  it("sends a visitor to open a studio, with no warning about the sign-in to come", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 300) });
    expect(screen.getByRole("link", { name: /Open a studio/ })).toHaveAttribute("href", "/studio/new");
    expect(screen.queryByText(/sign in or create an account/)).not.toBeInTheDocument();
  });

  it("sends an artist to their studio instead", () => {
    customer.data = { artistSlug: "rachel" };
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 300) });
    expect(screen.getByRole("link", { name: /Go to your studio/ })).toHaveAttribute("href", "/studio");
    expect(screen.queryByRole("link", { name: /Open a studio/ })).not.toBeInTheDocument();
  });
});
