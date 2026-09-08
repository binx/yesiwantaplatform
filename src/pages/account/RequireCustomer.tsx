import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Skeleton } from "antd";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useCustomer } from "@/lib/account";
import { AccountNav } from "./AccountNav";

/**
 * The customer-account gate — a storefront equivalent of `src/admin/RequireAdmin.tsx`.
 *
 * Also only a convenience: every `/api/account/*` route re-checks the session
 * itself, so this component deciding wrong costs nothing but a redirect. See
 * the note in RequireAdmin.tsx, which this mirrors.
 */
export function RequireCustomer() {
  const location = useLocation();
  const customer = useCustomer();

  if (customer.isPending) {
    return (
      <PageWrapper width="prose">
        <Skeleton active paragraph={{ rows: 6 }} />
      </PageWrapper>
    );
  }

  if (!customer.data) {
    return <Navigate to="/account/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <PageWrapper width="prose">
      <h1>Your account</h1>
      <AccountNav />
      <Outlet />
    </PageWrapper>
  );
}
