import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Badge, Button, Drawer, Tooltip } from "antd";
import {
  MenuOutlined,
  ShoppingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { useCustomer } from "@/lib/account";
import { useCartCount } from "@/store/cart";
import { cx } from "@/lib/cx";
import styles from "./Banner.module.css";

/**
 * Site header. Both navigations render and CSS decides which shows, so there
 * is no width state and no layout flash.
 */
export function Banner() {
  const store = useStore();
  const count = useCartCount();
  const customer = useCustomer();
  const [open, setOpen] = useState(false);

  const accountHref = customer.data ? "/account" : "/account/login";
  const accountLabel = customer.data ? "Your account" : "Sign in";

  const links = [
    { to: "/create", label: "Make a postcard" },
    ...store.pages
      .filter((page) => page.inNav)
      .map((page) => ({ to: `/${page.slug}`, label: page.title })),
  ];

  const cartLabel =
    count > 0 ? `Cart, ${count} postcard${count === 1 ? "" : "s"}` : "Cart";
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
          <span className={styles.wordmark}>postcard gifts</span>
        )}
      </Link>

      <nav className={styles.desktopNav} aria-label="Main">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.active}` : styles.link
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <Tooltip title={accountLabel}>
        <Link to={accountHref} className={styles.cart} aria-label={accountLabel}>
          <UserOutlined className={styles.cartIcon} aria-hidden />
        </Link>
      </Tooltip>

      <Tooltip title="Cart">
        <Link to="/cart" className={styles.cart} aria-label={cartLabel}>
          <Badge
            count={count}
            size="small"
            color="var(--beluga-accent)"
            offset={[2, -2]}
          >
            <ShoppingOutlined className={styles.cartIcon} aria-hidden />
          </Badge>
        </Link>
      </Tooltip>

      <Button
        type="text"
        className={cx(styles.menuButton)}
        icon={<MenuOutlined />}
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
      />

      <Drawer
        title="Menu"
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
