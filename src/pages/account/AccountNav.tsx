import { NavLink, useLocation } from "react-router-dom";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

const LINKS = [
  { to: "/account", label: "Collections" },
  { to: "/account/postcards", label: "Mailed" },
  { to: "/account/settings", label: "Settings" },
] as const;

/**
 * The account's tabs: what you collect, what has been mailed, and the
 * rest. An artist's studio is its own section, reached from the site's
 * header, so it is not a tab here.
 *
 * Collections is the index, and a collection's own page belongs to it;
 * every other path under /account is some other tab's.
 */
export function AccountNav() {
  const { pathname } = useLocation();
  const active = (to: string) => (to === "/account" ? pathname === "/account" || pathname.startsWith("/account/collections") : pathname.startsWith(to));
  return (
    <nav className={cx(styles.nav)} aria-label="Account">
      {LINKS.map((link) => (
        <NavLink key={link.to} to={link.to} className={cx(styles.navLink, active(link.to) && styles.navLinkActive)} aria-current={active(link.to) ? "page" : undefined}>
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
