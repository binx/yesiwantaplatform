import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { OrderStatusTag } from "@/admin/OrderStatusTag";
import { useCustomerOrders } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

export function AccountOrdersPage() {
  const orders = useCustomerOrders();
  // The store's language, not the buyer's browser — see the order detail page.
  const { locale } = useStore();

  useEffect(() => {
    document.title = "Your orders · Your account";
  }, []);

  if (orders.isPending) return <Skeleton active paragraph={{ rows: 5 }} />;

  if (!orders.data || orders.data.length === 0) {
    return (
      <p className={cx(styles.empty)}>
        No orders yet. <Link to="/shop">Start shopping</Link>.
      </p>
    );
  }

  return (
    <table className={cx(styles.table)}>
      <thead>
        <tr>
          <th scope="col">Order</th>
          <th scope="col">Date</th>
          <th scope="col">Status</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {orders.data.map((order) => (
          <tr key={order.id}>
            <td>
              <Link to={`/account/orders/${order.id}`}>{order.reference}</Link>
            </td>
            <td className={cx(styles.meta)}>{new Date(order.createdAt).toLocaleDateString(locale)}</td>
            <td>
              <OrderStatusTag order={order} locale={locale} />
            </td>
            <td className={cx(styles.amount)}>{formatMoney(order.totalCents, order.currency, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
