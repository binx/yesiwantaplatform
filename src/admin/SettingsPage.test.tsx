import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test-utils";
import type { EmailTestResult } from "@shared/api";
import { EmailCheck } from "./SettingsPage";

/**
 * The "send a test email" control.
 *
 * Its whole reason to exist is that a misconfigured SMTP transport is
 * invisible: every other send here swallows its failure on purpose, so a wrong
 * port or a rejected sender looks exactly like success until a customer does
 * not get a confirmation. So what is asserted is that the transport's own
 * words reach the screen, in both directions.
 */

function mockApi(result: EmailTestResult | { status: number; error: string }) {
  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  // Assigned rather than stubbed: `vi.unstubAllGlobals` would also drop the
  // matchMedia and observer stubs vitest.setup.ts installs once.
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.endsWith("/api/session")) return json({ csrfToken: "token" });

    if ("status" in result) return json({ error: result.error }, result.status);
    return json(result);
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("EmailCheck", () => {
  it("cannot be pressed when the server has no SMTP configured", () => {
    mockApi({ ok: true, message: "unused" });

    renderWithProviders(<EmailCheck hasEmail={false} />);

    expect(screen.getByRole("button", { name: /send a test email/i })).toBeDisabled();
    expect(screen.getByText(/written to the log instead of sent/i)).toBeInTheDocument();
  });

  it("reports where the message went", async () => {
    mockApi({ ok: true, message: "Sent to owner@example.com." });

    renderWithProviders(<EmailCheck hasEmail />);
    await userEvent.click(screen.getByRole("button", { name: /send a test email/i }));

    expect(await screen.findByText(/Sent to owner@example.com\./)).toBeInTheDocument();
  });

  it("shows the transport's own refusal rather than a generic failure", async () => {
    mockApi({ ok: false, message: "535 5.7.8 Authentication credentials invalid" });

    renderWithProviders(<EmailCheck hasEmail />);
    await userEvent.click(screen.getByRole("button", { name: /send a test email/i }));

    expect(await screen.findByText(/The transport refused it/i)).toBeInTheDocument();
    expect(screen.getByText(/535 5\.7\.8/)).toBeInTheDocument();
  });

  it("separates a server that refused the request from a transport that refused the mail", async () => {
    mockApi({ status: 429, error: "Too many requests. Try again in a few minutes." });

    renderWithProviders(<EmailCheck hasEmail />);
    await userEvent.click(screen.getByRole("button", { name: /send a test email/i }));

    await waitFor(() => {
      expect(screen.getByText(/Could not reach the server/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/The transport refused it/i)).not.toBeInTheDocument();
  });
});
