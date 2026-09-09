import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "@/test-utils";
import type { ShippingRate, ShippingZone } from "@shared/shipping";
import { Wiring } from "./DashboardPage";
import type { ProductSummary, ShippingTable } from "./queries";

/**
 * The wiring panel on the Overview.
 *
 * The case worth pinning down is the public URL, because it is the one that
 * shows no symptom: a production deploy that never set `PUBLIC_URL` renders,
 * reaches Stripe and takes the money, then returns the buyer to a developer's
 * laptop. Whether the server is in production is the server's answer — the
 * browser's own origin is localhost whenever an admin is on an SSH tunnel, so
 * inferring it here would warn the wrong people and miss the right ones.
 */

/** Everything else wired up, so only the case under test can raise a notice. */
const wired = {
  hasStripeSecret: true,
  stripeMode: "test" as const,
  hasWebhookSecret: true,
  hasEmail: true,
  database: "sqlite" as const,
  publicUrl: "https://shop.example.com",
  production: true,
};

const warning = /Public URL is localhost/i;

describe("Wiring", () => {
  it("warns when a production server still points at localhost", () => {
    renderWithProviders(
      <Wiring environment={{ ...wired, publicUrl: "http://localhost:5173", production: true }} />,
    );

    expect(screen.getByText(warning)).toBeInTheDocument();
    // The value itself, so the merchant can tell which address is wrong.
    expect(screen.getByText(/http:\/\/localhost:5173/)).toBeInTheDocument();
  });

  it("says nothing about localhost in development, where it is the point", () => {
    renderWithProviders(
      <Wiring environment={{ ...wired, publicUrl: "http://localhost:5173", production: false }} />,
    );

    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });

  it("says nothing when production has a real address", () => {
    renderWithProviders(<Wiring environment={wired} />);

    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    expect(screen.getByText(/Everything is wired up/i)).toBeInTheDocument();
  });

  it("does not suppress the notices it is added alongside", () => {
    renderWithProviders(
      <Wiring
        environment={{
          ...wired,
          publicUrl: "http://127.0.0.1:5173",
          production: true,
          hasStripeSecret: false,
          stripeMode: null,
        }}
      />,
    );

    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByText(/Stripe is not connected/i)).toBeInTheDocument();
  });
});

/**
 * Shipping, on the screen every session starts on.
 *
 * A store with no rates ships free and says nothing until an order arrives
 * with no postage on it — docs/shipping.md §3.3 calls this the silent failure.
 * A coverage gap is the same failure one step in: the buyer is simply offered
 * nothing. Both are warned about here, and both are gated so they cannot fire
 * at a merchant who has nothing to ship.
 */

const product = (over: Partial<ProductSummary> = {}): ProductSummary => ({
  id: "p1",
  name: "Tote",
  slug: "tote",
  isLive: true,
  needsPublish: false,
  needsTaxRepublish: false,
  kind: "physical",
  ...over,
});

const zone = (over: Partial<ShippingZone> = {}): ShippingZone => ({
  id: "z1",
  name: "United Kingdom",
  countryCodes: ["GB"],
  position: 0,
  ...over,
});

const rate = (over: Partial<ShippingRate> = {}): ShippingRate => ({
  id: "r1",
  name: "Standard",
  priceCents: 500,
  zoneId: null,
  minWeightGrams: null,
  maxWeightGrams: null,
  minSubtotalCents: null,
  maxSubtotalCents: null,
  taxBehavior: "exclusive",
  isActive: true,
  position: 0,
  ...over,
});

const empty: ShippingTable = { zones: [], rates: [] };

const noRates = /No shipping rates/i;
const gapWarning = /Some destinations have no rate/i;

describe("Wiring, on shipping", () => {
  it("warns when a store with a live physical product has no rates", () => {
    renderWithProviders(<Wiring environment={wired} shipping={empty} products={[product()]} />);

    expect(screen.getByText(noRates)).toBeInTheDocument();
  });

  it("stays quiet for a store that sells only downloads", () => {
    renderWithProviders(
      <Wiring environment={wired} shipping={empty} products={[product({ kind: "digital" })]} />,
    );

    expect(screen.queryByText(noRates)).not.toBeInTheDocument();
  });

  it("stays quiet when the only physical product is a draft", () => {
    renderWithProviders(
      <Wiring environment={wired} shipping={empty} products={[product({ isLive: false })]} />,
    );

    expect(screen.queryByText(noRates)).not.toBeInTheDocument();
  });

  it("stays quiet while the shipping table is still loading", () => {
    renderWithProviders(<Wiring environment={wired} products={[product()]} />);

    expect(screen.queryByText(noRates)).not.toBeInTheDocument();
  });

  it("warns about a country the zones cover and the rates do not", () => {
    // A zone naming GB, and the only rate bounded to a parcel heavier than the
    // probe — so GB is offerable at checkout and matches nothing.
    renderWithProviders(
      <Wiring
        environment={wired}
        shipping={{ zones: [zone()], rates: [rate({ minWeightGrams: 5000 })] }}
        products={[product()]}
      />,
    );

    expect(screen.getByText(gapWarning)).toBeInTheDocument();
    expect(screen.getByText(/United Kingdom/)).toBeInTheDocument();
  });

  it("stays quiet when every covered country has a rate", () => {
    renderWithProviders(
      <Wiring
        environment={wired}
        shipping={{ zones: [zone()], rates: [rate()] }}
        products={[product()]}
      />,
    );

    expect(screen.queryByText(gapWarning)).not.toBeInTheDocument();
    expect(screen.queryByText(noRates)).not.toBeInTheDocument();
  });
});

describe("Wiring, on discount codes", () => {
  it("points at Stripe's coupons, in the mode the store is actually in", () => {
    renderWithProviders(<Wiring environment={wired} />);

    const link = screen.getByRole("link", { name: /coupons dashboard/i });
    expect(link).toHaveAttribute("href", "https://dashboard.stripe.com/test/coupons");
  });

  it("uses the live dashboard for a live store", () => {
    renderWithProviders(<Wiring environment={{ ...wired, stripeMode: "live" }} />);

    const link = screen.getByRole("link", { name: /coupons dashboard/i });
    expect(link).toHaveAttribute("href", "https://dashboard.stripe.com/coupons");
  });

  it("says nothing about codes when Stripe is not connected", () => {
    renderWithProviders(
      <Wiring environment={{ ...wired, hasStripeSecret: false, stripeMode: null }} />,
    );

    expect(screen.queryByRole("link", { name: /coupons dashboard/i })).not.toBeInTheDocument();
  });
});
