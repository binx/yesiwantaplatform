import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "@/test-utils";
import { Wiring } from "./DashboardPage";

const wired = {
  hasStripeSecret: true,
  stripeMode: "test" as const,
  stripeKeyStatus: "valid" as const,
  hasWebhookSecret: true,
  hasEmail: true,
  hasLob: true,
  lobMode: "test" as const,
  database: "sqlite" as const,
  publicUrl: "https://shop.example.com",
  production: true,
};

describe("Wiring", () => {
  it("says everything is wired up when it is", () => {
    renderWithProviders(<Wiring environment={wired} />);
    expect(screen.getByText(/Everything is wired up/i)).toBeInTheDocument();
  });

  it("shouts when Lob is missing, because paid orders would silently wait", () => {
    renderWithProviders(<Wiring environment={{ ...wired, hasLob: false, lobMode: null }} />);
    expect(screen.getByText(/Lob is not connected/i)).toBeInTheDocument();
  });

  it("flags a live Stripe key paired with a test Lob key", () => {
    renderWithProviders(<Wiring environment={{ ...wired, stripeMode: "live", lobMode: "test" }} />);
    expect(screen.getByText(/Stripe is live but Lob is in test mode/i)).toBeInTheDocument();
  });

  it("warns when production still points at localhost", () => {
    renderWithProviders(<Wiring environment={{ ...wired, publicUrl: "http://localhost:5173" }} />);
    expect(screen.getByText(/Public URL is localhost/i)).toBeInTheDocument();
  });
});
