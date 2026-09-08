import { Link, useSearchParams } from "react-router-dom";
import { getLiveProducts, getVisibleCollections } from "@shared/catalog";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductImage } from "@/components/ui/ProductImage";
import { ProductBrowser } from "@/components/product/ProductBrowser";
import { useStore } from "@/lib/useStore";
import styles from "./ShopPage.module.css";

export function ShopPage() {
  const store = useStore();
  const [params] = useSearchParams();
  const collections = getVisibleCollections(store);

  const query = (params.get("q") ?? "").trim();

  // The catalogue is the page. Collections used to replace it whenever the
  // store had any, which made "Shop everything" on the landing page a link to
  // two tiles and left no URL that showed the whole catalogue at all. They are
  // a way to narrow the catalogue, so they sit above it rather than instead of
  // it.
  //
  // A search is the one time they are noise: someone who has typed wants
  // products, not a choice of places to go looking.
  return (
    <PageWrapper width="wide">
      <h1>Shop</h1>

      {collections.length > 0 && query === "" && (
        <section className={styles.collections}>
          <h2 className={styles.heading}>Collections</h2>
          <ul className={styles.grid}>
            {collections.map((collection) => (
              <li key={collection.id}>
                <Link to={`/collection/${collection.slug}`} className={styles.card}>
                  <ProductImage
                    image={collection.cover}
                    ratio={16 / 9}
                    sizes="(max-width: 700px) 100vw, 50vw"
                  />
                  <h3 className={styles.name}>{collection.name}</h3>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        {/* The heading names what is under it. Leaving it at "All products"
            over a filtered list was the page contradicting itself. */}
        <h2 className={styles.heading}>{query ? `Results for “${query}”` : "All products"}</h2>
        <ProductBrowser
          products={getLiveProducts(store)}
          collection="All products"
          currency={store.currency}
        />
      </section>
    </PageWrapper>
  );
}
