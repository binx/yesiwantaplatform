import { Link } from "react-router-dom";
import { getLiveProducts, getVisibleCollections } from "@shared/catalog";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductImage } from "@/components/ui/ProductImage";
import { ProductList } from "@/components/product/ProductList";
import { useStore } from "@/lib/useStore";
import styles from "./ShopPage.module.css";

export function ShopPage() {
  const store = useStore();
  const collections = getVisibleCollections(store);

  // A store with no collections shows its whole catalogue rather than an
  // empty page.
  if (collections.length === 0) {
    return (
      <PageWrapper width="wide">
        <h1>All products</h1>
        <ProductList
          products={getLiveProducts(store)}
          collection="All products"
          currency={store.currency}
        />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper width="wide">
      <h1>Shop</h1>
      <ul className={styles.grid}>
        {collections.map((collection) => (
          <li key={collection.id}>
            <Link to={`/collection/${collection.slug}`} className={styles.card}>
              <ProductImage
                image={collection.cover}
                ratio={16 / 9}
                sizes="(max-width: 700px) 100vw, 50vw"
              />
              <h2 className={styles.name}>{collection.name}</h2>
            </Link>
          </li>
        ))}
      </ul>
    </PageWrapper>
  );
}
