import { NavLink } from "react-router-dom";
import { useCustomer } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

const LINKS = [
  { to: "/account", label: "Overview", end: true },
  { to: "/account/collections", label: "Collections", end: false },
  { to: "/account/postcards", label: "Postcards", end: false },
  { to: "/account/address", label: "Address", end: false },
] as const;

/** The account's tabs — and, for an artist, the way into their studio, which is the tab they came for. */
export function AccountNav() {
  const customer = useCustomer();
  const links = customer.data?.artistSlug ? [...LINKS, { to: "/studio", label: "Your studio", end: false }] : LINKS;
  return (
    <nav className={cx(styles.nav)} aria-label="Account">
      {links.map((link) => (
        <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}>
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
