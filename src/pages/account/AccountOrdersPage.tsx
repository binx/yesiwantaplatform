import { Link } from "react-router-dom";
import { Alert, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { useCustomerOrders } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { formatDay } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/** Receipts: one per month paid, per subscription. Written by Stripe's webhook, never by a page. */
export function AccountOrdersPage() {
  const store = useStore();
  const orders = useCustomerOrders();


  if (orders.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (orders.isError) return <Alert type="error" showIcon title="Your receipts could not be loaded." />;
  if (orders.data.length === 0) return <p className={cx(styles.empty)}>No payments yet.</p>;

  return (
    <table className={cx(styles.table)}>
      <thead>
        <tr>
          <th scope="col">Reference</th>
          <th scope="col">Artist</th>
          <th scope="col">For</th>
          <th scope="col">Paid</th>
          <th scope="col" className={styles.amount}>
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {orders.data.map((order) => (
          <tr key={order.id}>
            <td>{order.reference}</td>
            <td>
              <Link to={`/artist/${order.artist.slug}`}>{order.artist.name}</Link>
            </td>
            <td>{order.periodStart ? new Date(order.periodStart).toLocaleDateString(store.locale, { month: "long", year: "numeric" }) : "—"}</td>
            <td>{formatDay(order.createdAt, store.locale)}</td>
            <td className={styles.amount}>
              {formatMoney(order.amountCents, order.currency, store.locale)}
              {order.refundedCents > 0 ? <span className={cx(styles.meta)}> ({formatMoney(order.refundedCents, order.currency, store.locale)} refunded)</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
