import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test-utils";
import { ProductEditorPage } from "./ProductEditorPage";

/**
 * A new product, before anything has been typed.
 *
 * `problems(draft)` is right that an empty draft is invalid — no name, no web
 * address, no price — but rendering that as three red errors on an untouched
 * form reads as a broken page rather than as guidance. The rule is the one the
 * autosave indicator already follows: say nothing until there is something to
 * say. The second test is the one that matters most, because the cheap way to
 * pass the first is to stop showing the list at all.
 */

function mockApi() {
  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

  // Assigned rather than stubbed: `vi.unstubAllGlobals` would also drop the
  // matchMedia and observer stubs vitest.setup.ts installs once.
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.endsWith("/api/admin/settings")) {
      return json({ name: "Test Store", currency: "USD", theme: null });
    }
    if (url.endsWith("/api/admin/environment")) {
      return json({
        hasStripeSecret: true,
        stripeMode: "test",
        hasWebhookSecret: true,
        hasEmail: true,
        database: "sqlite",
        publicUrl: "http://localhost:5173",
        production: false,
      });
    }
    if (url.endsWith("/api/admin/shipping")) return json({ zones: [], rates: [] });

    return json({ csrfToken: "token" });
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function renderNewProduct() {
  mockApi();

  return renderWithProviders(
    <Routes>
      <Route path="/admin/products/new" element={<ProductEditorPage />} />
    </Routes>,
    { route: "/admin/products/new" },
  );
}

const issues = /Not saved yet/i;

describe("a brand-new product", () => {
  it("opens with no errors on it", async () => {
    renderNewProduct();

    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByText(issues)).not.toBeInTheDocument();
    expect(screen.queryByText(/A product needs a name/i)).not.toBeInTheDocument();
  });

  it("shows them as soon as the form is touched, so they are not lost", async () => {
    renderNewProduct();

    const name = await screen.findByLabelText("Name");
    await userEvent.type(name, "T");

    // Still invalid — a name alone is not a product — and now that the
    // merchant is filling it in, saying so is guidance rather than noise.
    await waitFor(() => expect(screen.getByText(issues)).toBeInTheDocument());
  });
});

describe("SKU and compare-at price", () => {
  it("keeps a variant's SKU when adding an option regenerates the matrix", async () => {
    renderNewProduct();

    await userEvent.type(await screen.findByLabelText("Name"), "Test Product");
    await userEvent.type(await screen.findByLabelText("SKU"), "MY-SKU");

    // Exact match fails here: antd's icon renders as `role="img"
    // aria-label="plus"`, which is folded into the button's accessible name
    // alongside its own text.
    await userEvent.click(await screen.findByRole("button", { name: /Add an option/ }));
    await userEvent.type(await screen.findByLabelText("Option name"), "Size");
    await userEvent.type(await screen.findByLabelText("Size value 1"), "Small");

    // Still one combination (one value on the new axis), so the single
    // pre-existing row should be matched and keep its SKU rather than being
    // replaced with a blank one.
    await waitFor(() => expect(screen.getByLabelText("SKU")).toHaveValue("MY-SKU"));
  });

  it("flags a compare-at price that is not higher than the price", async () => {
    renderNewProduct();

    await userEvent.type(await screen.findByLabelText("Name"), "Test Product");
    await userEvent.type(await screen.findByLabelText("Price"), "10.00");
    await userEvent.type(await screen.findByLabelText("Compare-at price"), "10.00");

    // Once in the summary alert and once as the field's own inline error.
    await waitFor(() =>
      expect(screen.getAllByText(/must be higher than the price/i)).toHaveLength(2),
    );
  });
});
