import { Link } from "react-router-dom";
import { useStore } from "@/lib/useStore";
import { useCustomer } from "@/lib/account";
import styles from "./Footer.module.css";

/**
 * Site footer: one line of links and the sign-off, together.
 *
 * Every published page is listed here, `inNav` or not — `Banner` lists only
 * pages with `inNav` set, and a privacy policy left out of the menu still has
 * to be reachable from somewhere.
 */
export function Footer() {
  const store = useStore();
  const customer = useCustomer();

  const accountHref = customer.data ? "/account" : "/account/login";

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav className={styles.links} aria-label="Footer">
          <Link to="/artists">Artists</Link>
          <Link to="/gallery">Gallery</Link>
          <Link to={customer.data?.artistSlug ? "/studio" : "/studio/new"}>For artists</Link>
          <Link to={accountHref}>Your account</Link>
          {store.pages.map((page) => (
            <Link key={page.id} to={`/${page.slug}`}>
              {page.title}
            </Link>
          ))}
        </nav>

        <p className={styles.legal}>
          {store.name} · a project by <a href="https://rachelbinx.com">rachel binx</a>, for the love of mail
        </p>
      </div>
    </footer>
  );
}
