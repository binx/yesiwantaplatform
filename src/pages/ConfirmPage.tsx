import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Result, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { apiGet } from "@/lib/api";
import { cx } from "@/lib/cx";
import { useCart } from "@/store/cart";
import styles from "./ConfirmPage.module.css";

interface ConfirmedOrder {
  reference: string;
  email: string;
  status: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  items: {
    productName: string;
    variantLabel: string;
    quantity: number;
    unitPriceCents: number;
    options: Record<string, string>;
  }[];
}

export function ConfirmPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const clear = useCart((s) => s.clear);

  const { data, error, isPending } = useQuery({
    queryKey: ["order", sessionId],
    queryFn: ({ signal }) => apiGet<ConfirmedOrder>(`/checkout/${sessionId ?? ""}`, signal),
    enabled: Boolean(sessionId),
    // The webhook may land a moment after the redirect; poll briefly rather
    // than telling the buyer their paid order is "pending".
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 2000 : false),
    retry: 3,
  });

  // Emptying the cart is driven by arriving here with a real order, not by the
  // click that started checkout — an abandoned payment keeps its cart.
  useEffect(() => {
    if (data) clear();
  }, [data, clear]);

  if (!sessionId) {
    return (
      <PageWrapper width="prose">
        <Result
          status="warning"
          title={<h1>No order to show</h1>}
          subTitle="This page is shown after a completed checkout."
          extra={
            <Link to="/shop">
              <Button type="primary">Back to the shop</Button>
            </Link>
          }
        />
      </PageWrapper>
    );
  }

  if (isPending) {
    return (
      <PageWrapper width="prose">
        <Skeleton active paragraph={{ rows: 5 }} />
      </PageWrapper>
    );
  }

  if (error || !data) {
    return (
      <PageWrapper width="prose">
        <Alert
          type="error"
          showIcon
          message="We couldn't load your order"
          description="Your payment may still have gone through. Check your email for a confirmation before trying again."
        />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper width="prose">
      <h1>Thank you for your order</h1>

      <p className={styles.lede}>
        Order <strong>{data.reference}</strong>
        {data.email ? (
          <>
            {" "}
            — a confirmation is on its way to <strong>{data.email}</strong>.
          </>
        ) : (
          "."
        )}
      </p>

      {data.status === "pending" && (
        <Alert
          type="info"
          showIcon
          className={cx(styles.pending)}
          message="Confirming your payment"
          description="This usually takes a few seconds. You can safely close this page — your confirmation email will still arrive."
        />
      )}

      <table className={styles.table}>
        <tbody>
          {data.items.map((item, i) => (
            <tr key={i}>
              <td>
                {item.productName}
                {item.variantLabel && <span className={styles.meta}> · {item.variantLabel}</span>}
                <span className={styles.meta}> × {item.quantity}</span>
              </td>
              <td className={styles.amount}>
                {formatMoney(item.unitPriceCents * item.quantity, data.currency)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Subtotal</td>
            <td className={styles.amount}>{formatMoney(data.subtotalCents, data.currency)}</td>
          </tr>
          <tr>
            <td>Shipping</td>
            <td className={styles.amount}>
              {data.shippingCents === 0 ? "Free" : formatMoney(data.shippingCents, data.currency)}
            </td>
          </tr>
          {data.taxCents > 0 && (
            <tr>
              <td>Tax</td>
              <td className={styles.amount}>{formatMoney(data.taxCents, data.currency)}</td>
            </tr>
          )}
          <tr className={styles.total}>
            <td>Total</td>
            <td className={styles.amount}>{formatMoney(data.totalCents, data.currency)}</td>
          </tr>
        </tfoot>
      </table>

      <p>
        <Link to="/shop">
          <Button>Continue shopping</Button>
        </Link>
      </p>
    </PageWrapper>
  );
}
