import { NavLink } from "react-router-dom";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

const LINKS = [
  { to: "/account", label: "Overview", end: true },
  { to: "/account/orders", label: "Orders", end: false },
  { to: "/account/recipients", label: "Recipients", end: false },
] as const;

export function AccountNav() {
  return (
    <nav className={cx(styles.nav)} aria-label="Account">
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
