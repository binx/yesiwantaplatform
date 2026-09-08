import { beforeEach, describe, expect, it } from "vitest";
import { storeSchema } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { useCart } from "@/store/cart";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test-utils";
import { CartPage } from "./CartPage";

/**
 * What the cart says while it is changing things under the shopper.
 *
 * Both assertions here are about silence. The quantity field clamped to the
 * stock on hand with no explanation, which reads as a broken input rather than
 * a limit; and every line carried "gift wrap: No" whether or not anyone had
 * chosen anything, which is noise that multiplies with each group a product
 * grows.
 */

const store = storeSchema.parse(demoStore);

/** Canvas Tote, Large: two in stock, and a "gift wrap" group defaulting to No. */
const line = {
  productId: "demo-tote",
  variantId: "demo-tote-l",
  quantity: 1,
  options: { "gift wrap": "No" },
};

beforeEach(() => {
  useCart.setState({ lines: [line], shipToCountry: null, shippingRateId: null });
});

describe("CartPage", () => {
  it("says why the quantity changed when it clamps to the stock on hand", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartPage />, { store, route: "/cart" });

    const quantity = screen.getByLabelText("Quantity for Canvas Tote");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.tab();

    // The same sentence the product page uses for low stock.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Only 2 left"));
    expect(useCart.getState().lines[0]?.quantity).toBe(2);
  });

  it("keeps quiet when the quantity asked for is available", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartPage />, { store, route: "/cart" });

    const quantity = screen.getByLabelText("Quantity for Canvas Tote");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.tab();

    await waitFor(() => expect(useCart.getState().lines[0]?.quantity).toBe(2));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("hides an option group still sitting on its default", () => {
    renderWithProviders(<CartPage />, { store, route: "/cart" });

    expect(screen.getByText("Canvas Tote")).toBeInTheDocument();
    expect(screen.queryByText(/gift wrap/i)).not.toBeInTheDocument();
  });

  it("shows an option group the shopper actually chose", () => {
    useCart.setState({ lines: [{ ...line, options: { "gift wrap": "Yes" } }] });

    renderWithProviders(<CartPage />, { store, route: "/cart" });

    expect(screen.getByText("gift wrap: Yes")).toBeInTheDocument();
  });
});
