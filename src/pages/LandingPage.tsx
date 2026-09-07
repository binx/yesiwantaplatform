import { Link } from "react-router-dom";
import { Button } from "antd";
import { getFeaturedProducts, getVisibleCollections } from "@shared/catalog";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductList } from "@/components/product/ProductList";
import { useStore } from "@/lib/useStore";
import styles from "./LandingPage.module.css";

export function LandingPage() {
  const store = useStore();
  const featured = getFeaturedProducts(store);
  const collections = getVisibleCollections(store);

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 className={styles.heroTitle}>{store.name}</h1>
          <p className={styles.heroText}>
            This is your storefront's hero. Edit it in the admin, or replace this component
            entirely — it is plain JSX.
          </p>
          <Link to="/shop">
            <Button type="primary" size="large">
              Shop everything
            </Button>
          </Link>
        </div>
      </section>

      <PageWrapper width="wide">
        {featured.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <h2>Featured</h2>
              <Link to="/shop" className={styles.more}>
                View all →
              </Link>
            </header>
            <ProductList products={featured} collection="Featured" currency={store.currency} />
          </section>
        )}

        {collections.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <h2>Collections</h2>
            </header>
            <ul className={styles.collections}>
              {collections.map((collection) => (
                <li key={collection.id}>
                  <Link to={`/collection/${collection.slug}`} className={styles.collectionCard}>
                    <span className={styles.collectionName}>{collection.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </PageWrapper>
    </>
  );
}
