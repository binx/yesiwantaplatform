import { Link, useLocation, useParams } from "react-router-dom";
import { findProduct } from "@shared/catalog";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { Carousel } from "@/components/product/Carousel";
import { ProductDetails } from "@/components/product/ProductDetails";
import { useStore } from "@/lib/useStore";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { NotFoundPage } from "./NotFoundPage";
import styles from "./ProductPage.module.css";

interface BreadcrumbState {
  collection?: string;
}

export function ProductPage() {
  const store = useStore();
  const { slug = "" } = useParams();
  const location = useLocation();

  const product = findProduct(store, slug);

  // Before the early return: hooks cannot be called conditionally, and a miss
  // leaves the shell's default title rather than naming a page that is not
  // being shown.
  useDocumentTitle(product?.isLive ? product.name : null);

  if (!product || !product.isLive) return <NotFoundPage />;

  const state = location.state as BreadcrumbState | null;
  const collection = state?.collection
    ? store.collections.find((c) => c.name === state.collection)
    : undefined;

  return (
    <PageWrapper width="wide">
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <ol>
          <li>
            <Link to={collection ? `/collection/${collection.slug}` : "/shop"}>
              {collection ? collection.name : "Shop"}
            </Link>
          </li>
          <li aria-current="page">{product.name}</li>
        </ol>
      </nav>

      <div className={styles.layout}>
        <Carousel images={product.images} productName={product.name} />
        <ProductDetails product={product} currency={store.currency} />
      </div>
    </PageWrapper>
  );
}
