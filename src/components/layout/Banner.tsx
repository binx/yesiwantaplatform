import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button, Drawer, Tooltip } from "antd";
import { MenuOutlined, UserOutlined } from "@ant-design/icons";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { useCustomer } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Banner.module.css";

/**
 * Site header. Both navigations render and CSS decides which shows, so there
 * is no width state and no layout flash.
 */
export function Banner() {
  const store = useStore();
  const customer = useCustomer();
  const [open, setOpen] = useState(false);

  const accountHref = customer.data ? "/account" : "/account/login";
  const accountLabel = customer.data ? "Your account" : "Sign in";

  const links = [
    { to: "/artists", label: "Artists" },
    { to: "/gallery", label: "Gallery" },
    ...store.pages.filter((page) => page.inNav).map((page) => ({ to: `/${page.slug}`, label: page.title })),
    // The studio is where an artist works; for everyone else, the pitch.
    { to: customer.data?.artistSlug ? "/studio" : "/for-artists", label: customer.data?.artistSlug ? "Your studio" : "For artists" },
  ];

  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand}>
        {store.theme.logo ? (
          <img className={cx(styles.logo)} src={assetUrl(store.theme.logo.path)} alt={store.theme.logo.alt || store.name} />
        ) : (
          <span className={styles.wordmark}>
            <span className={styles.wordmarkYes}>yes</span> i want a postcard
          </span>
        )}
      </Link>

      <nav className={styles.desktopNav} aria-label="Main">
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}>
            {link.label}
          </NavLink>
        ))}
      </nav>

      <Tooltip title={accountLabel}>
        <Link to={accountHref} className={styles.account} aria-label={accountLabel}>
          <UserOutlined className={styles.accountIcon} aria-hidden />
        </Link>
      </Tooltip>

      <Button type="text" className={cx(styles.menuButton)} icon={<MenuOutlined />} onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} />

      <Drawer title="Menu" placement="right" open={open} onClose={() => setOpen(false)}>
        <nav className={styles.drawerNav} aria-label="Main">
          <Link to="/" onClick={() => setOpen(false)}>
            Home
          </Link>
          {links.map((link) => (
            <Link key={link.to} to={link.to} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link to={accountHref} onClick={() => setOpen(false)}>
            {accountLabel}
          </Link>
        </nav>
      </Drawer>
    </header>
  );
}
