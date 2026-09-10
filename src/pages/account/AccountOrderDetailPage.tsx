import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Result, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { OrderStatusTag } from "@/admin/OrderStatusTag";
import { PostcardSchedule } from "@/components/postcard/PostcardSchedule";
import { useCustomerOrder } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

export function AccountOrderDetailPage() {
  const { id } = useParams();
  const order = useCustomerOrder(id);
  const { locale } = useStore();

  useEffect(() => {
    if (order.data) document.title = `Order ${order.data.reference} · Your account`;
  }, [order.data]);

  if (order.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;

  if (order.error || !order.data) {
    return (
      <Result
        status="404"
        title={<h2>No order found</h2>}
        subTitle="This order doesn't exist, or isn't on your account."
        extra={
          <Link to="/account/orders">
            <Button type="primary">Back to orders</Button>
          </Link>
        }
      />
    );
  }

  const data = order.data;
  const price = (cents: number) => formatMoney(cents, data.currency, locale);

  return (
    <div>
      <p>
        <Link to="/account/orders">← Back to orders</Link>
      </p>

      <div className={cx(styles.cardHeader)}>
        <h2>Order {data.reference}</h2>
        <OrderStatusTag order={data} locale={locale} />
      </div>

      <p className={cx(styles.meta)}>Placed {new Date(data.createdAt).toLocaleDateString(locale)}</p>

      <PostcardSchedule order={data} locale={locale} />

      <table className={cx(styles.table)}>
        <tfoot>
          <tr>
            <td>
              {data.postcardCount - data.internationalCount} postcard{data.postcardCount - data.internationalCount === 1 ? "" : "s"} × {price(data.unitPriceCents)}
              {data.internationalCount > 0 && data.internationalUnitPriceCents !== null
                ? ` + ${data.internationalCount} abroad × ${price(data.internationalUnitPriceCents)}`
                : ""}
            </td>
            <td className={cx(styles.amount)}>{price(data.subtotalCents)}</td>
          </tr>
          {data.discountCents > 0 && (
            <tr>
              <td>Discount</td>
              <td className={cx(styles.amount)}>−{price(data.discountCents)}</td>
            </tr>
          )}
          {data.refundedCents > 0 && (
            <tr>
              <td>Refunded</td>
              <td className={cx(styles.amount)}>−{price(data.refundedCents)}</td>
            </tr>
          )}
          <tr>
            <td>
              <strong>Total</strong>
            </td>
            <td className={cx(styles.amount)}>
              <strong>{price(data.totalCents)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
