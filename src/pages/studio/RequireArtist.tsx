import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { Skeleton, Tag } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useCustomer } from "@/lib/account";
import { useStudio } from "@/lib/platform";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

const LINKS = [
  { to: "/studio", label: "Overview", end: true },
  { to: "/studio/queue", label: "Queue", end: false },
  { to: "/studio/subscribers", label: "Subscribers", end: false },
  { to: "/studio/earnings", label: "Earnings", end: false },
  { to: "/studio/profile", label: "Your page", end: false },
] as const;

/**
 * The studio gate — a convenience, not the security boundary: every
 * `/api/studio/*` route re-checks the session and the artist row itself.
 *
 * Three states: signed out (to the login, with this page as the way back);
 * signed in with no artist page yet (only `/studio/new` renders, everything
 * else redirects there); an artist (the nav and the page).
 */
export function RequireArtist() {
  const location = useLocation();
  const customer = useCustomer();
  const studio = useStudio(Boolean(customer.data));
  const creating = location.pathname === "/studio/new";

  if (customer.isPending || (customer.data && studio.isPending)) {
    return (
      <PageWrapper>
        <Skeleton active paragraph={{ rows: 6 }} />
      </PageWrapper>
    );
  }

  if (!customer.data) return <Navigate to="/account/login" replace state={{ from: location.pathname }} />;

  if (!studio.data) {
    if (!creating) return <Navigate to="/studio/new" replace />;
    return (
      <PageWrapper>
        <Outlet />
      </PageWrapper>
    );
  }

  if (creating) return <Navigate to="/studio" replace />;

  const { artist } = studio.data;
  const statusColor = artist.status === "live" ? "green" : artist.status === "paused" ? "gold" : "default";

  return (
    <PageWrapper width="wide">
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Studio</h1>
          <p className={styles.subtitle}>
            {artist.name} <Tag color={statusColor}>{artist.status}</Tag>
            {artist.status === "live" ? (
              <a href={`/artist/${artist.slug}`} target="_blank" rel="noreferrer">
                /artist/{artist.slug}
              </a>
            ) : (
              <span>/artist/{artist.slug} — not public yet</span>
            )}
          </p>
        </div>
      </header>
      <nav className={cx(styles.nav)} aria-label="Studio">
        {LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}>
            {link.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={studio.data} />
    </PageWrapper>
  );
}
