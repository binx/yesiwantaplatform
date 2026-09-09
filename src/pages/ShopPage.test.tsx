import { describe, expect, it } from "vitest";
import { storeSchema } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen, userEvent, waitFor } from "@/test-utils";
import { ShopPage } from "./ShopPage";

/**
 * Storefront search.
 *
 * Filtering is client-side against the already-loaded catalogue, so these
 * assertions stand without a server or a fetch mock — which is also the point
 * of the feature.
 */

const store = storeSchema.parse(demoStore);

function renderShop(route = "/shop") {
  return renderWithProviders(<ShopPage />, { store, route });
}

describe("ShopPage search", () => {
  it("shows the collections and the whole catalogue side by side", () => {
    renderShop();

    expect(screen.getByRole("heading", { name: "Shop" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Collections" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toBeInTheDocument();

    // The point of the page: "Shop everything" has to land on everything.
    expect(screen.getByRole("heading", { name: "All products" })).toBeInTheDocument();
    expect(screen.getByText("Canvas Tote")).toBeInTheDocument();
    expect(screen.getByText("Enamel Mug")).toBeInTheDocument();
  });

  it("titles the list after the query, and drops the collections while searching", () => {
    renderShop("/shop?q=tote");

    expect(screen.getByRole("heading", { name: "Results for “tote”" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "All products" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Collections" })).not.toBeInTheDocument();
  });

  it("deep-links a query through ?q=", () => {
    renderShop("/shop?q=tote");

    expect(screen.getByLabelText("Search")).toHaveValue("tote");
    expect(screen.getByText("Canvas Tote")).toBeInTheDocument();
    expect(screen.queryByText("Enamel Mug")).not.toBeInTheDocument();
  });

  it("filters as you type and announces the count", async () => {
    const user = userEvent.setup();
    renderShop("/shop?q=x");

    const input = screen.getByLabelText("Search");
    await user.clear(input);
    await user.type(input, "mug");

    await waitFor(() => expect(screen.getByText("Enamel Mug")).toBeInTheDocument());

    // The count lives in a polite live region so typing is not silent.
    const count = screen.getByText(/product/i, { selector: "[aria-live]" });
    expect(count).toHaveTextContent("1 product matching “mug”");
    expect(screen.queryByText("Canvas Tote")).not.toBeInTheDocument();
  });

  it("offers a way out of a query that matches nothing", async () => {
    const user = userEvent.setup();
    renderShop("/shop?q=bicycle");

    // One statement of the miss, in the live region — the empty block used to
    // repeat it as prose directly underneath.
    const count = screen.getByText(/product/i, { selector: "[aria-live]" });
    expect(count).toHaveTextContent("0 products matching “bicycle”");
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show everything" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "All products" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Canvas Tote")).toBeInTheDocument();
  });

  it("sorts by price without losing the query", async () => {
    const user = userEvent.setup();
    renderShop("/shop?q=e");

    await user.selectOptions(screen.getByLabelText("Sort by"), "price-asc");

    await waitFor(() => expect(screen.getByLabelText("Search")).toHaveValue("e"));
    expect(screen.getByLabelText("Sort by")).toHaveValue("price-asc");
  });
});
