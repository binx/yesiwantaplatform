import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Badge, Button, Drawer } from "antd";
import { MenuOutlined, ShoppingOutlined, UserOutlined } from "@ant-design/icons";
import { getVisibleCollections } from "@shared/catalog";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { useCustomer } from "@/lib/account";
import { useCartCount } from "@/store/cart";
import { cx } from "@/lib/cx";
import styles from "./Banner.module.css";

/**
 * Site header.
 *
 * v1 chose between the desktop bar and the mobile drawer with MUI's `withWidth`
 * HOC — a JS breakpoint that was removed in MUI v5 and that re-rendered the
 * whole header on resize. Both navigations render here and CSS decides, so
 * there is no width state and no layout flash.
 */
export function Banner() {
  const store = useStore();
  const count = useCartCount();
  const customer = useCustomer();
  const [open, setOpen] = useState(false);

  // Signed-in goes straight to order history; signed-out goes to sign-in
  // rather than a dead-end profile page it cannot show.
  const accountHref = customer.data ? "/account" : "/account/login";
  const accountLabel = customer.data ? "Your account" : "Sign in";

  // The About page is a page like any other once a store has migrated. Until
  // then `aboutText` still drives the link — but only when no page has claimed
  // the slug, or the header would carry the same destination twice.
  const hasAboutPage = store.pages.some((page) => page.slug === "about");

  const links = [
    { to: "/shop", label: "Shop" },
    ...getVisibleCollections(store).map((c) => ({
      to: `/collection/${c.slug}`,
      label: c.name,
    })),
    ...store.pages
      .filter((page) => page.inNav)
      .map((page) => ({ to: `/${page.slug}`, label: page.title })),
    ...(store.aboutText && !hasAboutPage ? [{ to: "/about", label: "About" }] : []),
  ];

  // Two labels for two jobs. The icon has no text, so its aria-label has to
  // read as a whole sentence — "Cart, 2 items". The drawer's entry is visible
  // text in a list of one-word links, and that sentence read as shouted
  // boilerplate there once the drawer's uppercase styling got hold of it.
  const cartLabel = count > 0 ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart";
  const cartText = count > 0 ? `Cart (${count})` : "Cart";

  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand}>
        {store.theme.logo ? (
          <img
            className={cx(styles.logo)}
            src={assetUrl(store.theme.logo.path)}
            alt={store.theme.logo.alt || store.name}
          />
        ) : (
          store.name
        )}
      </Link>

      <nav className={styles.desktopNav} aria-label="Main">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <Link to={accountHref} className={styles.cart} aria-label={accountLabel}>
        <UserOutlined className={styles.cartIcon} aria-hidden />
      </Link>

      <Link to="/cart" className={styles.cart} aria-label={cartLabel}>
        <Badge count={count} size="small" color="var(--beluga-accent)" offset={[2, -2]}>
          <ShoppingOutlined className={styles.cartIcon} aria-hidden />
        </Badge>
      </Link>

      <Button
        type="text"
        className={cx(styles.menuButton)}
        icon={<MenuOutlined />}
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
      />

      <Drawer
        title={store.name}
        placement="right"
        open={open}
        onClose={() => setOpen(false)}
      >
        <nav className={styles.drawerNav} aria-label="Main">
          <Link to="/" onClick={() => setOpen(false)}>
            Home
          </Link>
          {links.map((link) => (
            <Link key={link.to} to={link.to} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link to="/cart" onClick={() => setOpen(false)}>
            {cartText}
          </Link>
          <Link to={accountHref} onClick={() => setOpen(false)}>
            {accountLabel}
          </Link>
        </nav>
      </Drawer>
    </header>
  );
}
