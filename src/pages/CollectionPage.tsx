import { useParams } from "react-router-dom";
import { findCollection, getCollectionProducts, getLiveProducts } from "@shared/catalog";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductBrowser } from "@/components/product/ProductBrowser";
import { useStore } from "@/lib/useStore";
import { NotFoundPage } from "./NotFoundPage";

export function CollectionPage() {
  const store = useStore();
  const { slug = "" } = useParams();

  if (slug === "all-products") {
    return (
      <PageWrapper width="wide">
        <h1>All products</h1>
        <ProductBrowser
          products={getLiveProducts(store)}
          collection="All products"
          currency={store.currency}
        />
      </PageWrapper>
    );
  }

  const collection = findCollection(store, slug);
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
