import { Link } from "react-router-dom";
import { useStore } from "@/lib/useStore";
import styles from "./Footer.module.css";

/**
 * Site footer.
 *
 * Every published page is listed here, `inNav` or not — `Banner` lists only
 * pages with `inNav` set, and a privacy policy left out of the menu still has
 * to be reachable from somewhere.
 */
export function Footer() {
  const store = useStore();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav className={styles.column} aria-label="Postcards">
          <h2 className={styles.heading}>Postcards</h2>
          <Link to="/create">Make a postcard</Link>
          <Link to="/cart">Cart</Link>
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
          <Link to="/account/orders">Your orders</Link>
        </div>
      </div>

      <p className={styles.legal}>
        made by <a href="https://rachelbinx.com">rachel binx</a>, for the love of mail
      </p>
    </footer>
  );
}
