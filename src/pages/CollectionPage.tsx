import { useParams, useSearchParams } from "react-router-dom";
import {
  findCollection,
  getCollectionProducts,
  getLiveProducts,
} from "@shared/catalog";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductBrowser } from "@/components/product/ProductBrowser";
import { useStore } from "@/lib/useStore";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { cx } from "@/lib/cx";
import { NotFoundPage } from "./NotFoundPage";
import styles from "./CollectionPage.module.css";

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
          locale={store.locale}
        />
      </PageWrapper>
    );
  }

  if (!collection) return <NotFoundPage />;

  return (
    <PageWrapper width="wide">
      <h1>{collection.name}</h1>

      {/*
       * Server-rendered and server-sanitised — see server/markdown.ts. The
       * storefront ships no Markdown parser and does not have to trust what
       * it is handed; the allow-list is applied on the way out, so tightening
       * it reaches every collection already written.
       *
       * Above the search and sort controls: it introduces the collection, and
       * a shopper who has typed a query is past being introduced to it.
       */}
      {collection.descriptionHtml ? (
        <div
          className={cx(styles.description)}
          dangerouslySetInnerHTML={{ __html: collection.descriptionHtml }}
        />
      ) : null}

      {/* Scoped to this collection: a shopper in "Paper goods" searching for
          "print" means a print in here, not one anywhere in the store. */}
      <ProductBrowser
        products={getCollectionProducts(store, slug)}
        collection={collection.name}
        currency={store.currency}
        locale={store.locale}
      />
    </PageWrapper>
  );
}
