import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test-utils";
import { useCart } from "@/store/cart";
import type { Product } from "@shared/schema";
import { ProductDetails } from "./ProductDetails";

const baseProduct: Product = {
  id: "p1",
  slug: "tote",
  name: "Canvas Tote",
  description: "A bag.",
  bulletPoints: [],
  seoTitle: null,
  seoDescription: null,
  images: [],
  variantName: "size",
  variants: [
    {
      id: "v-small",
      label: "Small",
      priceCents: 3400,
      inventory: { type: "finite", quantity: 12 },
      weightGrams: 0,
      stripePriceId: null,
    },
    {
      id: "v-large",
      label: "Large",
      priceCents: 4200,
      inventory: { type: "finite", quantity: 2 },
      weightGrams: 0,
      stripePriceId: null,
    },
  ],
  optionGroups: [],
  taxCode: null,
  stripeTaxSignature: null,
  isLive: true,
  stripeProductId: null,
};

beforeEach(() => {
  useCart.setState({ lines: [] });
});

describe("ProductDetails", () => {
  it("shows the variant picker for a product with a single variant axis", () => {
    // v1 required more than one variant *group* to render this, so a product
    // whose only axis was size showed no picker and silently shipped "Small".
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" />);

    expect(screen.getByText("size")).toBeInTheDocument();
    expect(screen.getByText("Small")).toBeInTheDocument();
  });

  it("hides the picker when there is genuinely nothing to choose", () => {
    const single: Product = {
      ...baseProduct,
      variantName: null,
      variants: [baseProduct.variants[0]!],
    };
    renderWithProviders(<ProductDetails product={single} currency="USD" />);

    expect(screen.queryByText("size")).not.toBeInTheDocument();
  });

  it("prices from the selected variant", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" />);

    expect(screen.getByText("$34.00")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTitle("Large"));

    await waitFor(() => expect(screen.getByText("$42.00")).toBeInTheDocument());
  });

  it("clamps quantity to the variant's stock", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" />);

    // Switch to Large, which holds 2 units.
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTitle("Large"));

    const quantity = screen.getByRole("spinbutton", { name: /quantity/i });
    await user.clear(quantity);
    await user.type(quantity, "999");
    await user.tab();

    await waitFor(() => expect(quantity).toHaveValue("2"));
  });

  it("adds identifiers to the cart, never a price", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" />);

    await user.click(screen.getByRole("button", { name: /add to cart/i }));

    const [line] = useCart.getState().lines;
    expect(line).toMatchObject({ productId: "p1", variantId: "v-small", quantity: 1 });
    // Prices are derived from the catalogue at render time; storing one here is
    // what left v1's carts showing stale amounts after a price change.
    expect(line).not.toHaveProperty("price");
  });

  it("disables purchase for a sold-out product", () => {
    const soldOut: Product = {
      ...baseProduct,
      variantName: null,
      variants: [
        {
          id: "v-only",
          label: "",
          priceCents: 6500,
          inventory: { type: "finite", quantity: 0 },
          weightGrams: 0,
          stripePriceId: null,
        },
      ],
    };
    renderWithProviders(<ProductDetails product={soldOut} currency="USD" />);

    expect(screen.getByRole("button", { name: /sold out/i })).toBeDisabled();
  });
});
