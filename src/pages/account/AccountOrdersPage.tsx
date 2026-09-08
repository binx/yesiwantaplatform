import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { OrderStatusTag } from "@/admin/OrderStatusTag";
import { useCustomerOrders } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

export function AccountOrdersPage() {
  const orders = useCustomerOrders();

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
            <td className={cx(styles.meta)}>{new Date(order.createdAt).toLocaleDateString()}</td>
            <td>
              <OrderStatusTag order={order} />
            </td>
            <td className={cx(styles.amount)}>{formatMoney(order.totalCents, order.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
