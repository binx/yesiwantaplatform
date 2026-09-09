import { useParams, useSearchParams } from "react-router-dom";
import { findCollection, getCollectionProducts, getLiveProducts } from "@shared/catalog";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductBrowser } from "@/components/product/ProductBrowser";
import { useStore } from "@/lib/useStore";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { NotFoundPage } from "./NotFoundPage";

export function CollectionPage() {
  const store = useStore();
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const query = (params.get("q") ?? "").trim();

  const isAllProducts = slug === "all-products";
  const collection = isAllProducts ? null : findCollection(store, slug);

  /*
   * Resolved before the early returns below, because hooks cannot be called
   * conditionally. The tab is named for the collection rather than the search
   * inside it: a bookmark of "Home Goods?q=mug" should still say Home Goods.
   */
  useDocumentTitle(isAllProducts ? "All products" : (collection?.name ?? null));

  if (isAllProducts) {
    return (
      <PageWrapper width="wide">
        {/* The heading names what is under it, so a filtered list is not
            titled "All products". A named collection below keeps its own
            name: the search there is scoped to it, and "Results for ..."
            would read as store-wide. */}
        <h1>{query ? `Results for “${query}”` : "All products"}</h1>
        <ProductBrowser
          products={getLiveProducts(store)}
          collection="All products"
          currency={store.currency}
        />
      </PageWrapper>
    );
  }

  if (!collection) return <NotFoundPage />;

  return (
    <PageWrapper width="wide">
      <h1>{collection.name}</h1>
      {/* Scoped to this collection: a shopper in "Paper goods" searching for
          "print" means a print in here, not one anywhere in the store. */}
      <ProductBrowser
        products={getCollectionProducts(store, slug)}
        collection={collection.name}
        currency={store.currency}
      />
    </PageWrapper>
  );
}
