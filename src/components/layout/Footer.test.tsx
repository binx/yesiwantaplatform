import { describe, expect, it } from "vitest";
import { storeSchema, type Store } from "@shared/schema";
import { getVisibleCollections } from "@shared/catalog";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, screen, within } from "@/test-utils";
import { Footer } from "./Footer";

/**
 * The footer exists to make published pages reachable.
 *
 * `Banner` lists only pages with `inNav` set, so before this component a page
 * left out of the nav had no link to it anywhere on the site — a returns policy
 * a customer could not find. That is what the first test here guards, and it is
 * the assertion most likely to be broken by a well-meaning tidy-up of the page
 * list.
 */

function storeWith(pages: Store["pages"]): Store {
  return storeSchema.parse({ ...demoStore, pages });
}

describe("Footer", () => {
  it("links every published page, in the nav or not", () => {
    const store = storeWith([
      { id: "p1", slug: "about", title: "About", inNav: true, position: 0 },
      { id: "p2", slug: "returns", title: "Returns", inNav: false, position: 1 },
    ]);

    renderWithProviders(<Footer />, { store });

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");

    // The whole point: not in the nav, still reachable.
    expect(within(footer).getByRole("link", { name: "Returns" })).toHaveAttribute(
      "href",
      "/returns",
    );
  });

  it("carries the store name, the year and a route to the whole catalogue", () => {
    const store = storeWith([]);

    renderWithProviders(<Footer />, { store });

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(`© ${new Date().getFullYear()} ${store.name}`)).toBeVisible();
    expect(within(footer).getByRole("link", { name: "All products" })).toHaveAttribute(
      "href",
      "/shop",
    );
  });

  it("lists the same collections the header does", () => {
    const store = storeWith([]);

    renderWithProviders(<Footer />, { store });

    const shop = screen.getByRole("navigation", { name: "Shop" });
    for (const collection of getVisibleCollections(store)) {
      expect(within(shop).getByRole("link", { name: collection.name })).toHaveAttribute(
        "href",
        `/collection/${collection.slug}`,
      );
    }
  });

  it("drops the information column when a store has no pages", () => {
    renderWithProviders(<Footer />, { store: storeWith([]) });

    expect(screen.queryByRole("navigation", { name: "Information" })).not.toBeInTheDocument();
  });
});
