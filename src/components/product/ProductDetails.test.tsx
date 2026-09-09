import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test-utils";
import { useCart } from "@/store/cart";
import type { Product } from "@shared/schema";
import { ProductDetails } from "./ProductDetails";

const baseProduct: Product = {
  id: "p1",
  slug: "tote",
  name: "Canvas Tote",
  kind: "physical",
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
      sku: null,
      compareAtPriceCents: null,
      inventory: { type: "finite", quantity: 12 },
      weightGrams: 0,
      stripePriceId: null,
      optionValues: ["Small"],
    },
    {
      id: "v-large",
      label: "Large",
      priceCents: 4200,
      sku: null,
      // On sale, so a test can assert the struck-through price shows for the
      // selected variant only.
      compareAtPriceCents: 4800,
      inventory: { type: "finite", quantity: 2 },
      weightGrams: 0,
      stripePriceId: null,
      optionValues: ["Large"],
    },
  ],
  options: [{ id: "opt-size", name: "size", values: ["Small", "Large"] }],
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
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" locale="en-US" />);

    expect(screen.getByText("size")).toBeInTheDocument();
    expect(screen.getByText("Small")).toBeInTheDocument();
  });

  it("hides the picker when there is genuinely nothing to choose", () => {
    const single: Product = {
      ...baseProduct,
      variantName: null,
      options: [],
      variants: [{ ...baseProduct.variants[0]!, optionValues: [] }],
    };
    renderWithProviders(<ProductDetails product={single} currency="USD" locale="en-US" />);

    expect(screen.queryByText("size")).not.toBeInTheDocument();
  });

  it("prices from the selected variant", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" locale="en-US" />);

    expect(screen.getByText("$34.00")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTitle("Large"));

    await waitFor(() => expect(screen.getByText("$42.00")).toBeInTheDocument());
  });

  it("shows a struck-through compare-at price only for a variant on sale", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" locale="en-US" />);

    // Small has no compare-at price.
    expect(screen.queryByText("$48.00")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTitle("Large"));

    // Large is marked down from $48.00 to $42.00.
    await waitFor(() => expect(screen.getByText("$42.00")).toBeInTheDocument());
    expect(screen.getByText("$48.00")).toBeInTheDocument();
  });

  it("tells the caller which variant resolved, including on first render", async () => {
    const user = userEvent.setup();
    const onVariantChange = vi.fn();
    renderWithProviders(
      <ProductDetails
        product={baseProduct}
        currency="USD"
        locale="en-US"
        onVariantChange={onVariantChange}
      />,
    );

    // Fires for the default selection without anyone touching a control —
    // otherwise a visitor who never picks a variant sees an unordered
    // carousel, since nothing ever told the page which variant is shown.
    await waitFor(() => expect(onVariantChange).toHaveBeenCalledWith("v-small"));

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByTitle("Large"));

    await waitFor(() => expect(onVariantChange).toHaveBeenCalledWith("v-large"));
  });

  it("prices in the store's language, not always the American one", () => {
    /*
     * The bug: `formatMoney` defaulted to `en-US` and all seventeen callers
     * took the default, so a German shop selling in euros put its decimal
     * separator in the thousands position — `€34,00` became `€34.00`, which
     * reads as thirty-four euros in Berlin only by accident.
     *
     * Asserted on the separator rather than the whole string because `Intl`
     * puts a non-breaking space before the €, and which space it uses has
     * changed between ICU releases.
     */
    renderWithProviders(<ProductDetails product={baseProduct} currency="EUR" locale="de-DE" />);

    const price = screen.getByText(/34,00/);

    expect(price).toBeInTheDocument();
    expect(price.textContent).toContain("€");
    // The one that would still be wrong if the locale were ignored.
    expect(screen.queryByText(/34\.00/)).not.toBeInTheDocument();
  });

  it("clamps quantity to the variant's stock", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" locale="en-US" />);

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
    renderWithProviders(<ProductDetails product={baseProduct} currency="USD" locale="en-US" />);

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
      options: [],
      variants: [
        {
          id: "v-only",
          label: "",
          priceCents: 6500,
          sku: null,
          compareAtPriceCents: null,
          inventory: { type: "finite", quantity: 0 },
          weightGrams: 0,
          stripePriceId: null,
          optionValues: [],
        },
      ],
    };
    renderWithProviders(<ProductDetails product={soldOut} currency="USD" locale="en-US" />);

    expect(screen.getByRole("button", { name: /sold out/i })).toBeDisabled();
  });

  const twoAxisProduct: Product = {
    ...baseProduct,
    id: "p2",
    slug: "hoodie",
    name: "Zip Hoodie",
    variantName: "size",
    options: [
      { id: "opt-size", name: "size", values: ["Small", "Large"] },
      { id: "opt-colour", name: "colour", values: ["Black", "Blue"] },
    ],
    variants: [
      {
        id: "v-s-black",
        label: "Small / Black",
        priceCents: 5000,
        sku: null,
        compareAtPriceCents: null,
        inventory: { type: "finite", quantity: 5 },
        weightGrams: 0,
        stripePriceId: null,
        optionValues: ["Small", "Black"],
      },
      {
        id: "v-s-blue",
        label: "Small / Blue",
        priceCents: 5000,
        sku: null,
        compareAtPriceCents: null,
        // Sold out — offered but disabled, not silently missing.
        inventory: { type: "finite", quantity: 0 },
        weightGrams: 0,
        stripePriceId: null,
        optionValues: ["Small", "Blue"],
      },
      {
        id: "v-l-black",
        label: "Large / Black",
        priceCents: 5500,
        sku: null,
        compareAtPriceCents: null,
        inventory: { type: "finite", quantity: 3 },
        weightGrams: 0,
        stripePriceId: null,
        optionValues: ["Large", "Black"],
      },
      {
        id: "v-l-blue",
        label: "Large / Blue",
        priceCents: 5500,
        sku: null,
        compareAtPriceCents: null,
        inventory: { type: "infinite" },
        weightGrams: 0,
        stripePriceId: null,
        optionValues: ["Large", "Blue"],
      },
    ],
  };

  it("renders one selector per axis and resolves the right variant", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductDetails product={twoAxisProduct} currency="USD" locale="en-US" />);

    expect(screen.getByText("size")).toBeInTheDocument();
    expect(screen.getByText("colour")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();

    const [sizeSelect, colourSelect] = screen.getAllByRole("combobox");

    await user.click(sizeSelect!);
    await user.click(await screen.findByTitle("Large"));
    await waitFor(() => expect(screen.getByText("$55.00")).toBeInTheDocument());

    await user.click(colourSelect!);
    await user.click(await screen.findByTitle("Blue"));

    await user.click(screen.getByRole("button", { name: /add to cart/i }));
    const [line] = useCart.getState().lines;
    expect(line).toMatchObject({ productId: "p2", variantId: "v-l-blue", quantity: 1 });
  });

  it("marks a sold-out combination rather than allowing a dead selection", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProductDetails product={twoAxisProduct} currency="USD" locale="en-US" />);

    const [, colourSelect] = screen.getAllByRole("combobox");
    await user.click(colourSelect!);

    // Small + Blue exists in the catalogue but has no stock left.
    expect(await screen.findByTitle("Blue — sold out")).toBeInTheDocument();
  });
});
