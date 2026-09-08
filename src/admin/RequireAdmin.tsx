import type { ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button, Grid, Menu, Skeleton, Typography } from "antd";
import {
  AppstoreOutlined,
  CarOutlined,
  LogoutOutlined,
  ProfileOutlined,
  SettingOutlined,
  TeamOutlined,
  ShopOutlined,
  ShoppingOutlined,
} from "@ant-design/icons";
import { useLogout, useSession } from "@/lib/session";
import { useSettings } from "./queries";
import { cx } from "@/lib/cx";
import styles from "./AdminLayout.module.css";

/**
 * The admin gate.
 *
 * This is a *convenience*, not the security boundary — every admin route
 * re-checks the session server-side, so a user who edits their way past this
 * component reaches an API that answers 401. That separation is the lesson
 * from v1, where the client decided who was an admin (`/user` returned
 * `isAdmin: true` outside production) and the API trusted it.
 */

const NAV = [
  { key: "", icon: <AppstoreOutlined />, label: "Overview" },
  { key: "products", icon: <ShoppingOutlined />, label: "Products" },
  { key: "collections", icon: <ProfileOutlined />, label: "Collections" },
  { key: "orders", icon: <ShopOutlined />, label: "Orders" },
  { key: "shipping", icon: <CarOutlined />, label: "Shipping" },
  { key: "users", icon: <TeamOutlined />, label: "Staff" },
  { key: "settings", icon: <SettingOutlined />, label: "Settings" },
];

function selectedKey(pathname: string): string {
  const rest = pathname.replace(/^\/admin\/?/, "");
  const first = rest.split("/")[0] ?? "";
  return NAV.some((item) => item.key === first) ? first : "";
}

export function RequireAdmin() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const settings = useSettings();
  const logout = useLogout();
  const screens = Grid.useBreakpoint();

  if (session.isPending) {
    return (
      <div className={cx(styles.content)}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  // An unreachable API and a signed-out session both land here; the login page
  // can report either without this component having to tell them apart.
  if (!session.data?.isAdmin) {
    if (session.data && !session.data.isConfigured) return <Navigate to="/setup" replace />;
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  const isWide = screens.md !== false;

  return (
    <div className={cx(styles.shell)}>
      <nav className={cx(styles.sidebar)} aria-label="Admin">
        <div className={cx(styles.brand)}>
          <span aria-hidden="true">🎷🐋</span>
          <span>
            Beluga
            {settings.data ? <span className={cx(styles.brandStore)}>{settings.data.name}</span> : null}
          </span>
        </div>

        {/*
          * Only the wide layout gets an antd Menu.
          *
          * `mode="horizontal"` measures its items and folds whatever does not
          * fit behind an "…" overflow — on a phone that was *every* item, so
          * the admin had no navigation at all. A plain list that scrolls
          * sideways keeps all five destinations reachable.
          */}
        {isWide ? (
          <Menu
            className={cx(styles.nav)}
            mode="inline"
            selectedKeys={[selectedKey(location.pathname)]}
            items={NAV.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: <Link to={`/admin/${item.key}`}>{item.label}</Link>,
            }))}
          />
        ) : (
          <ul className={cx(styles.navStrip)}>
            {NAV.map((item) => {
              const current = selectedKey(location.pathname) === item.key;
              return (
                <li key={item.key}>
                  <Link
                    to={`/admin/${item.key}`}
                    className={cx(styles.navLink, current && styles.navLinkCurrent)}
                    {...(current ? { "aria-current": "page" as const } : {})}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className={cx(styles.sidebarFooter)}>
          <Link to="/">{isWide ? "View storefront →" : "Storefront"}</Link>
          <Button
            icon={<LogoutOutlined />}
            loading={logout.isPending}
            onClick={() => {
              logout.mutate(undefined, { onSuccess: () => void navigate("/admin/login") });
            }}
          >
            Sign out
          </Button>
        </div>
      </nav>

      <div className={cx(styles.content)}>
        <Outlet />
      </div>
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={cx(styles.pageHeader)}>
      <div>
        <Typography.Title level={1} className={cx(styles.pageTitle)}>
          {title}
        </Typography.Title>
        {description ? <p className={cx(styles.pageDescription)}>{description}</p> : null}
      </div>
      {actions ? <div className={cx(styles.pageActions)}>{actions}</div> : null}
    </header>
  );
}
