import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "@/test-utils";
import { Wiring } from "./DashboardPage";

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
