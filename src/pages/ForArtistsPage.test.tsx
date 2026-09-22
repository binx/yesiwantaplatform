import { describe, expect, it, vi } from "vitest";
import { storeSchema } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen } from "@/test-utils";
import { ForArtistsPage } from "./ForArtistsPage";

const customer = vi.hoisted(() => ({ data: null as null | { artistSlug: string | null } }));
vi.mock("@/lib/account", () => ({ useCustomer: () => customer }));

const withPricing = (printCostCents: number, platformFeeCents: number, minMonthlyPriceCents: number) =>
  storeSchema.parse({ ...demoStore, pricing: { printCostCents, platformFeeCents, minMonthlyPriceCents } });

describe("the for-artists page", () => {
  it("prints the floor, the costs and the worked example from settings, never from prose", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(130, 45, 350) });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Share your art, build an audience");
    expect(screen.getByText(/from \$3\.50 a month/)).toBeInTheDocument();
    expect(screen.getByText(/take \$1\.30 and our fee takes \$0\.45/)).toBeInTheDocument();
    // $5.00 − $1.75 = $3.25, by artistShareCents, not by hand.
    const example = screen.getByLabelText(/What a \$5\.00 subscription pays/);
    expect(example).toHaveTextContent("$5.00");
    expect(example).toHaveTextContent("$1.75");
    expect(example).toHaveTextContent("$3.25");
  });

  it("uses the floor as the example when it is above five dollars", () => {
    customer.data = null;
    renderWithProviders(<ForArtistsPage />, { store: withPricing(120, 60, 800) });
    expect(screen.getByLabelText(/What a \$8\.00 subscription pays/)).toHaveTextContent("$6.20");
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
