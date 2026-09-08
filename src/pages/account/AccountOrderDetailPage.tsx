import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Result, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { OrderStatusTag } from "@/admin/OrderStatusTag";
import { useCustomerOrder } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

export function AccountOrderDetailPage() {
  const { id } = useParams();
  const order = useCustomerOrder(id);

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

  return (
    <div>
      <p>
        <Link to="/account/orders">← Back to orders</Link>
      </p>

      <div className={cx(styles.cardHeader)}>
        <h2>Order {data.reference}</h2>
        <OrderStatusTag order={data} />
      </div>

      <p className={cx(styles.meta)}>
        Placed {new Date(data.createdAt).toLocaleDateString()}
        {data.trackingNumber ? (
          <>
            {" "}
            · {data.carrier ? `${data.carrier} ` : ""}tracking {data.trackingNumber}
          </>
        ) : null}
      </p>

      <table className={cx(styles.table)}>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.productName}
                {item.variantLabel ? <span className={cx(styles.meta)}> · {item.variantLabel}</span> : null}
                <span className={cx(styles.meta)}> × {item.quantity}</span>
              </td>
              <td className={cx(styles.amount)}>
                {formatMoney(item.unitPriceCents * item.quantity, data.currency)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Subtotal</td>
            <td className={cx(styles.amount)}>{formatMoney(data.subtotalCents, data.currency)}</td>
          </tr>
          {data.discountCents > 0 && (
            <tr>
              <td>Discount</td>
              <td className={cx(styles.amount)}>
                {"−"}
                {formatMoney(data.discountCents, data.currency)}
              </td>
            </tr>
          )}
          <tr>
            <td>Shipping</td>
            <td className={cx(styles.amount)}>
              {data.shippingCents === 0 ? "Free" : formatMoney(data.shippingCents, data.currency)}
            </td>
          </tr>
          {data.taxCents > 0 && (
            <tr>
              <td>Tax</td>
              <td className={cx(styles.amount)}>{formatMoney(data.taxCents, data.currency)}</td>
            </tr>
          )}
          <tr>
            <td>
              <strong>Total</strong>
            </td>
            <td className={cx(styles.amount)}>
              <strong>{formatMoney(data.totalCents, data.currency)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>

      {data.shipping.line1 ? (
        <div className={cx(styles.card)}>
          <p>
            <strong>Shipping to</strong>
          </p>
          <p className={cx(styles.meta)}>
            {data.shipping.name}
            <br />
            {data.shipping.line1}
            {data.shipping.line2 ? (
              <>
                <br />
                {data.shipping.line2}
              </>
            ) : null}
            <br />
            {[data.shipping.city, data.shipping.state, data.shipping.postalCode]
              .filter(Boolean)
              .join(", ")}
            <br />
            {data.shipping.country}
          </p>
        </div>
      ) : null}
    </div>
  );
}
