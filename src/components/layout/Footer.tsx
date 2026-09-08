import { Link } from "react-router-dom";
import { getVisibleCollections } from "@shared/catalog";
import { useStore } from "@/lib/useStore";
import styles from "./Footer.module.css";

/**
 * Site footer.
 *
 * Mostly it is here to close a hole rather than to sign the page off. `Banner`
 * lists only pages with `inNav` set, and until this existed there was no other
 * link to a page anywhere on the site — so a merchant could publish a returns
 * policy, a shipping page or terms and no customer could ever reach them. Every
 * published page is listed here, `inNav` or not, which is the part that matters.
 *
 * `store.pages` is already live-only (`listPageSummaries({ liveOnly: true })`
 * in the snapshot), so a draft page is not linked from here by accident.
 */
export function Footer() {
  const store = useStore();
  const collections = getVisibleCollections(store);

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav className={styles.column} aria-label="Shop">
          <h2 className={styles.heading}>Shop</h2>
          <Link to="/shop">All products</Link>
          {collections.map((collection) => (
            <Link key={collection.id} to={`/collection/${collection.slug}`}>
              {collection.name}
            </Link>
          ))}
        </nav>

        {store.pages.length > 0 && (
          <nav className={styles.column} aria-label="Information">
            <h2 className={styles.heading}>Information</h2>
            {store.pages.map((page) => (
              <Link key={page.id} to={`/${page.slug}`}>
                {page.title}
              </Link>
            ))}
          </nav>
        )}

        <div className={styles.column}>
          <h2 className={styles.heading}>Account</h2>
          <Link to="/account">Your account</Link>
          <Link to="/cart">Cart</Link>
        </div>
      </div>

      <p className={styles.legal}>
        © {new Date().getFullYear()} {store.name}
      </p>
    </footer>
  );
}
