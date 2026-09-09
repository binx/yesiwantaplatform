import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "antd";
import { getFeaturedProducts, getVisibleCollections } from "@shared/catalog";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductList } from "@/components/product/ProductList";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./LandingPage.module.css";

/**
 * The hero's call to action.
 *
 * A router `Link` for a path and a plain anchor for an absolute URL: handing
 * `https://…` to `Link` makes react-router try to resolve it as an in-app
 * route, which lands on the 404 page rather than the destination.
 * `heroHrefSchema` has already refused everything that is neither of those, so
 * this is a two-way branch and not a validation.
 */
function HeroButton({ href, children }: { href: string; children: ReactNode }) {
  const button = (
    <Button type="primary" size="large">
      {children}
    </Button>
  );

  if (href.startsWith("/")) return <Link to={href}>{button}</Link>;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {button}
    </a>
  );
}

export function LandingPage() {
  const store = useStore();
  const hero = store.hero;
  const featured = getFeaturedProducts(store);
  const collections = getVisibleCollections(store);

  return (
    <>
      {/*
        * Every field falls back, so a store that has set none of this renders
        * exactly what it rendered before the hero was editable: the store
        * name, no paragraph, and a Shop everything button. The copy that used
        * to sit here promised an admin field that did not exist; it does now,
        * under Settings → Landing page.
        */}
      <section
        className={cx(styles.hero, hero.image && styles.hasImage)}
        {...(hero.image
          ? { style: { backgroundImage: `url(${assetUrl(hero.image.path)})` } }
          : {})}
      >
        <div className={styles.heroInner}>
          <h1 className={styles.heroTitle}>{hero.heading ?? store.name}</h1>
          {hero.text ? <p className={styles.heroText}>{hero.text}</p> : null}
          <HeroButton href={hero.buttonHref ?? "/shop"}>
            {hero.buttonLabel ?? "Shop everything"}
          </HeroButton>
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
            <ProductList
              products={featured}
              collection="Featured"
              currency={store.currency}
              locale={store.locale}
            />
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
