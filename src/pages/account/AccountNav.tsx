import { NavLink, useLocation } from "react-router-dom";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

const LINKS = [
  { to: "/account", label: "Settings" },
  { to: "/account/collections", label: "Collections" },
  { to: "/account/postcards", label: "Mailed" },
] as const;

/**
 * The account's tabs: who you are, what you collect, and what has been
 * mailed. An artist's studio is its own section, reached from the site's
 * header and from Settings, so it is not a tab here.
 *
 * Settings is the index, so it is active only on /account itself; a
 * collection's own page belongs to Collections.
 */
export function AccountNav() {
  const { pathname } = useLocation();
  const active = (to: string) => (to === "/account" ? pathname === "/account" || pathname === "/account/" : pathname.startsWith(to));
  return (
    <nav className={cx(styles.nav)} aria-label="Account">
      {LINKS.map((link) => (
        <NavLink key={link.to} to={link.to} end={link.to === "/account"} className={cx(styles.navLink, active(link.to) && styles.navLinkActive)} aria-current={active(link.to) ? "page" : undefined}>
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
