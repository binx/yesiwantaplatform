import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test-utils";
import { defaultTheme } from "@shared/schema";
import type { SetupStatus } from "@shared/api";
import { SetupPage } from "./SetupPage";

/**
 * The last step of the first-run wizard.
 *
 * The wizard writes no `.env` — the server reads `PUBLIC_URL` before it boots,
 * and a value a browser could set would be a value anyone with an admin
 * session could set. So the only honest thing it can do about a store that is
 * about to be deployed still pointing at localhost is say so, which is what
 * these assert.
 */

const WIZARD_STORAGE_KEY = "beluga:setup-wizard";

/** Open the wizard on its final step, past the two that need real input. */
function resumeOnLastStep() {
  sessionStorage.setItem(
    WIZARD_STORAGE_KEY,
    JSON.stringify({
      step: 2,
      identity: {
        storeName: "Blue Whale Goods",
        currency: "USD",
        email: "owner@example.com",
        password: "a-sufficiently-long-passphrase",
      },
      publishableKey: "",
      theme: defaultTheme,
      seedDemo: false,
    }),
  );
}

function mockSetupStatus(status: Partial<SetupStatus>) {
  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

  // Assigned rather than stubbed: `vi.unstubAllGlobals` would also drop the
  // matchMedia and observer stubs vitest.setup.ts installs once, and antd's
  // components ask for a breakpoint on render.
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.endsWith("/api/setup")) {
      return json({
        needsSetup: true,
        hasAdmin: false,
        hasSettings: false,
        hasStripeSecret: true,
        stripeMode: "test",
        requiresToken: false,
        ...status,
      } satisfies SetupStatus);
    }

    return json({ csrfToken: "token" });
  });
}

const originalFetch = globalThis.fetch;

beforeEach(resumeOnLastStep);

afterEach(() => {
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const note = /public URL is still localhost/i;

describe("the setup wizard's last step", () => {
  it("says so when the server will hand Stripe a localhost address", async () => {
    mockSetupStatus({ publicUrl: "http://localhost:5173" });

    renderWithProviders(<SetupPage />);

    expect(await screen.findByText(note)).toBeInTheDocument();
    // The value itself: a developer on a non-default port needs to see which.
    expect(screen.getByText("http://localhost:5173")).toBeInTheDocument();
  });

  it("stays quiet once the server has a real public address", async () => {
    mockSetupStatus({ publicUrl: "https://shop.example.com" });

    renderWithProviders(<SetupPage />);

    // Wait for the step to render before asserting on what is absent.
    expect(await screen.findByRole("button", { name: /create my store/i })).toBeInTheDocument();
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it("stays quiet against a server too old to report one", async () => {
    mockSetupStatus({});

    renderWithProviders(<SetupPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create my store/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });
});
