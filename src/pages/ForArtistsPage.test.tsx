import { describe, expect, it, vi } from "vitest";
import { storeSchema } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen } from "@/test-utils";
import { ForArtistsPage } from "./ForArtistsPage";

const customer = vi.hoisted(() => ({ data: null as null | { artistSlug: string | null } }));
vi.mock("@/lib/account", () => ({ useCustomer: () => customer }));

const withPricing = (printCostCents: number, platformFeeCents: number, minCardPriceCents: number) =>
  storeSchema.parse({ ...demoStore, pricing: { printCostCents, platformFeeCents, minCardPriceCents } });

describe("the for-artists page", () => {
  it("prints the per-card floor, the costs and the worked edition from settings, never from prose", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(130, 45, 350) });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Share your art, build an audience");
    expect(screen.getByText(/from \$3\.50 a card/)).toBeInTheDocument();
    expect(screen.getByText(/take \$1\.30 and our fee takes \$0\.45/)).toBeInTheDocument();
    // Six cards at $5.00: $5.00 − $1.75 = $3.25 a card, $19.50 a set, by cardGrossCents and artistShareCents, not by hand.
    const example = screen.getByLabelText(/What a \$30\.00 edition of 6 pays/);
    expect(example).toHaveTextContent("$30.00");
    expect(example).toHaveTextContent("$5.00");
    expect(example).toHaveTextContent("$1.75");
    expect(example).toHaveTextContent("$3.25");
    expect(example).toHaveTextContent("$19.50");
  });

  it("uses the floor as the example's per-card price when it is above five dollars", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 800) });
    expect(screen.getByLabelText(/What a \$48\.00 edition of 6 pays/)).toHaveTextContent("$6.20");
  });

  it("sends a visitor to open a studio, and warns that a sign-in comes first", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 300) });
    expect(screen.getByRole("link", { name: /Open a studio/ })).toHaveAttribute("href", "/studio/new");
    expect(screen.getByText(/sign in or create an account first/)).toBeInTheDocument();
  });

  it("drops the sign-in warning for a signed-in customer", () => {
    customer.data = { artistSlug: null };
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 300) });
    expect(screen.getByRole("link", { name: /Open a studio/ })).toHaveAttribute("href", "/studio/new");
    expect(screen.queryByText(/sign in or create an account first/)).not.toBeInTheDocument();
  });

  it("sends an artist to their studio instead", () => {
    customer.data = { artistSlug: "rachel" };
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 300) });
    expect(screen.getByRole("link", { name: /Go to your studio/ })).toHaveAttribute("href", "/studio");
    expect(screen.queryByRole("link", { name: /Open a studio/ })).not.toBeInTheDocument();
  });
});
