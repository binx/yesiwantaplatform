import { NavLink } from "react-router-dom";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

const LINKS = [
  { to: "/account", label: "Subscriptions", end: true },
  { to: "/account/postcards", label: "Postcards", end: false },
  { to: "/account/address", label: "Address", end: false },
  { to: "/account/receipts", label: "Receipts", end: false },
] as const;

export function AccountNav() {
  return (
    <nav className={cx(styles.nav)} aria-label="Account">
      {LINKS.map((link) => (
        <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}>
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
