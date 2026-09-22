import { Link, useLocation } from "react-router-dom";
import { Button, Empty } from "antd";
import { PageHeader } from "./RequireAdmin";

/**
 * An unknown /admin URL.
 *
 * `/admin` had no splat child, so a typo fell through to the root `{ path: "*" }`
 * and an administrator got the *storefront's* 404 — the sidebar gone, and the
 * only way onward a "Back to the shop" button that does not go back to the
 * admin. This keeps them inside the admin, with its chrome and its navigation.
 */
export function AdminNotFoundPage() {
  const location = useLocation();


  return (
    <>
      <PageHeader title="Not found" description={`Nothing is served at ${location.pathname}.`} />
      <Empty description="That address does not match an admin page." image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <Link to="/admin">
          <Button type="primary">Back to the overview</Button>
        </Link>
      </Empty>
    </>
  );
}
