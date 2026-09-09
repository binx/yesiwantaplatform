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
          {/*
            * Says what is true today.
            *
            * The previous copy promised "edit it in the admin", and there is
            * no admin field for it — a first-run merchant goes looking and
            * finds nothing. Task 21 adds the field; until it lands, this
            * points at the file that actually holds the text.
            */}
          <p className={styles.heroText}>
            Replace this text in <code>src/pages/LandingPage.tsx</code>, or wait for the
            admin field — it is plain JSX either way.
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
