import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";
import { storeSchema } from "@shared/schema";
import { demoStore } from "@shared/demo-store";
import { renderWithProviders, waitFor } from "@/test-utils";
import { ShopPage } from "./ShopPage";
import { ProductPage } from "./ProductPage";
import { CollectionPage } from "./CollectionPage";

/**
 * What the tab, the history entry and the bookmark say.
 *
 * The production HTML handler already writes `Canvas Tote · Beluga Demo` into
 * `<title>` for the path being requested (`server/seo.ts`). Then React booted
 * and the shell's `DocumentTitle` overwrote it with the bare store name on
 * every route, so the server's work was undone on hydration and every tab read
 * alike. These pin the client to the same `name · store` shape the server
 * produces — the head a crawler reads and the title a person sees must not be
 * two different answers.
 */

const store = storeSchema.parse(demoStore);

/** Rendered through a real route, because these pages read `useParams`. */
function renderAt(route: string, path: string, element: React.ReactElement) {
  return renderWithProviders(
    <Routes>
      <Route path={path} element={element} />
    </Routes>,
    { store, route },
  );
}

afterEach(() => {
  document.title = "";
});

describe("document.title", () => {
  it("names the product", async () => {
    renderAt("/product/canvas-tote", "/product/:slug", <ProductPage />);

    await waitFor(() => expect(document.title).toBe("Canvas Tote · Beluga Demo"));
  });

  it("names the collection", async () => {
    renderAt("/collection/home-goods", "/collection/:slug", <CollectionPage />);

    await waitFor(() => expect(document.title).toBe("Home Goods · Beluga Demo"));
  });

  it("names the whole catalogue", async () => {
    renderAt("/collection/all-products", "/collection/:slug", <CollectionPage />);

    await waitFor(() => expect(document.title).toBe("All products · Beluga Demo"));
  });

  it("names the shop", async () => {
    renderAt("/shop", "/shop", <ShopPage />);

    await waitFor(() => expect(document.title).toBe("Shop · Beluga Demo"));
  });

  it("keeps naming the collection while a search is filtering it", async () => {
    // A bookmark of a filtered collection should still say what it is a
    // collection of; the query belongs in the URL, not the tab.
    renderAt("/collection/home-goods?q=mug", "/collection/:slug", <CollectionPage />);

    await waitFor(() => expect(document.title).toBe("Home Goods · Beluga Demo"));
  });

  it("leaves the shell's title alone for a slug that does not resolve", async () => {
    document.title = "Beluga Demo";

    renderAt("/product/does-not-exist", "/product/:slug", <ProductPage />);

    // Naming a page that is not being shown would be worse than saying
    // nothing — the not-found page is what actually rendered.
    await waitFor(() => expect(document.title).toBe("Beluga Demo"));
  });

  it("leaves it alone for a draft, which the storefront refuses to render", async () => {
    document.title = "Beluga Demo";

    const draft = storeSchema.parse({
      ...demoStore,
      products: demoStore.products.map((product) =>
        product.slug === "canvas-tote" ? { ...product, isLive: false } : product,
      ),
    });

    renderWithProviders(
      <Routes>
        <Route path="/product/:slug" element={<ProductPage />} />
      </Routes>,
      { store: draft, route: "/product/canvas-tote" },
    );

    await waitFor(() => expect(document.title).toBe("Beluga Demo"));
  });
});
