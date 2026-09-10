import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Result, Skeleton } from "antd";
import { orderSchema, type Order } from "@shared/orders";
import { formatMoney } from "@shared/money";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PostcardSchedule } from "@/components/postcard/PostcardSchedule";
import { apiGet } from "@/lib/api";
import { cx } from "@/lib/cx";
import { useCart } from "@/store/cart";
import { useStore } from "@/lib/useStore";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./ConfirmPage.module.css";

/**
 * The page Stripe returns the buyer to — and the page every email links to.
 *
 * Polls until the webhook has marked the order paid rather than assuming
 * payment succeeded because the buyer landed here. Keyed by the session id,
 * which is unguessable, so a guest can come back to it from the email weeks
 * later and see which cards have gone out.
 */
export function ConfirmPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const clear = useCart((s) => s.clear);
  const store = useStore();
  useDocumentTitle("Your order");

  const { data, error, isPending } = useQuery({
    queryKey: ["order", sessionId],
    queryFn: async ({ signal }) => orderSchema.parse(await apiGet<Order>(`/checkout/${sessionId ?? ""}`, signal)),
    enabled: Boolean(sessionId),
    // The webhook may land a moment after the redirect; poll briefly rather
    // than telling the buyer their paid order is "pending".
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 2000 : false),
    retry: 3,
  });

  // Emptying the cart is driven by arriving here with a real order, not by the
  // click that started checkout — an abandoned payment keeps its cart.
  useEffect(() => {
    if (data && data.status !== "pending") clear();
  }, [data, clear]);

  if (!sessionId) {
    return (
      <PageWrapper width="prose">
        <Result
          status="warning"
          title={<h1>No order to show</h1>}
          subTitle="This page is shown after a completed checkout."
          extra={
            <Link to="/create">
              <Button type="primary">Make a postcard</Button>
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
          title="We couldn't load your order"
          description="Your payment may still have gone through. Check your email for a confirmation before trying again."
        />
      </PageWrapper>
    );
  }

  const price = (cents: number) => formatMoney(cents, data.currency, store.locale);

  return (
    <PageWrapper>
      <h1>{data.status === "pending" ? "Confirming your payment" : "Thank you for your order!"}</h1>

      <p className={styles.lede}>
        Order <strong>{data.reference}</strong>
        {data.email ? (
          <>
            {" "}
            — a confirmation is on its way to <strong>{data.email}</strong>. You'll get another email
            each time a postcard goes to print.
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
          title="Confirming your payment"
          description="This usually takes a few seconds. You can safely close this page — your confirmation email will still arrive."
        />
      )}

      {data.status === "cancelled" && (
        <Alert type="warning" showIcon className={cx(styles.pending)} title="This order was cancelled." />
      )}

      <p className={styles.note}>Bookmark this page to follow your postcards' progress.</p>

      <PostcardSchedule order={data} locale={store.locale} />

      <table className={styles.table}>
        <tfoot>
          <tr>
            <td>
              {data.postcardCount - data.internationalCount} postcard{data.postcardCount - data.internationalCount === 1 ? "" : "s"} × {price(data.unitPriceCents)}
              {data.internationalCount > 0 && data.internationalUnitPriceCents !== null
                ? ` + ${data.internationalCount} abroad × ${price(data.internationalUnitPriceCents)}`
                : ""}
            </td>
            <td className={styles.amount}>{price(data.subtotalCents)}</td>
          </tr>
          {data.discountCents > 0 && (
            <tr>
              <td>Discount</td>
              <td className={styles.amount}>−{price(data.discountCents)}</td>
            </tr>
          )}
          <tr className={styles.total}>
            <td>Total</td>
            <td className={styles.amount}>{price(data.totalCents)}</td>
          </tr>
        </tfoot>
      </table>

      <p>
        <Link to="/create">
          <Button>Make more postcards</Button>
        </Link>
      </p>
    </PageWrapper>
  );
}
