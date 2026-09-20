import type { ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button, Grid, Menu, Skeleton, Typography } from "antd";
import { AppstoreOutlined, DollarOutlined, FileTextOutlined, LogoutOutlined, MailOutlined, SettingOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { useLogout, useSession } from "@/lib/session";
import { useSettings } from "./queries";
import { cx } from "@/lib/cx";
import styles from "./AdminLayout.module.css";

/**
 * The admin gate.
 *
 * This is a *convenience*, not the security boundary — every admin route
 * re-checks the session server-side, so a user who edits their way past this
 * component reaches an API that answers 401.
 */

const NAV = [
  { key: "", icon: <AppstoreOutlined />, label: "Overview" },
  { key: "artists", icon: <TeamOutlined />, label: "Artists" },
  { key: "mailings", icon: <MailOutlined />, label: "Mailings" },
  { key: "payouts", icon: <DollarOutlined />, label: "Payouts" },
  { key: "customers", icon: <UserOutlined />, label: "People" },
  { key: "pages", icon: <FileTextOutlined />, label: "Pages" },
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

  if (!session.data?.isAdmin) {
    if (session.data && !session.data.isConfigured) return <Navigate to="/setup" replace />;
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  const isWide = screens.md !== false;

  return (
    <div className={cx(styles.shell)}>
      <nav className={cx(styles.sidebar)} aria-label="Admin">
        <div className={cx(styles.brand)}>
          <span aria-hidden="true">✉️</span>
          <span>
            Admin
            {settings.data ? <span className={cx(styles.brandStore)}>{settings.data.name}</span> : null}
          </span>
        </div>

        {isWide ? (
          <Menu
            className={cx(styles.nav)}
            mode="inline"
            selectedKeys={[selectedKey(location.pathname)]}
            items={NAV.map((item) => ({ key: item.key, icon: item.icon, label: <Link to={`/admin/${item.key}`}>{item.label}</Link> }))}
          />
        ) : (
          <ul className={cx(styles.navStrip)}>
            {NAV.map((item) => {
              const current = selectedKey(location.pathname) === item.key;
              return (
                <li key={item.key}>
                  <Link to={`/admin/${item.key}`} className={cx(styles.navLink, current && styles.navLinkCurrent)} {...(current ? { "aria-current": "page" as const } : {})}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className={cx(styles.sidebarFooter)}>
          <Link to="/">{isWide ? "View the site →" : "Site"}</Link>
          <Button icon={<LogoutOutlined />} loading={logout.isPending} onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate("/admin/login") })}>
            Sign out
          </Button>
        </div>
      </nav>

      <main className={cx(styles.content)}>
        <Outlet />
      </main>
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
