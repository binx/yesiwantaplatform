import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Skeleton } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { countPostcards, countPostcardsByDestination, type CartLine } from "@shared/cart";
import { formatMoney } from "@shared/money";
import { formatRecipient } from "@shared/postcards";
import { ApiError, apiPost } from "@/lib/api";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatMailDate } from "@/lib/postcards";
import { useDesigns } from "@/lib/designs";
import { useStore } from "@/lib/useStore";
import { useCustomer } from "@/lib/account";
import { useRecoverCart } from "@/lib/cart-recovery";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useCart } from "@/store/cart";
import { cx } from "@/lib/cx";
import styles from "./CartPage.module.css";

/**
 * The cart.
 *
 * Holds design ids, dates and recipients, never a price or an image: the
 * price is the store's setting and the thumbnails are re-fetched from the
 * designs API on every render, so a design cleaned up since is shown as
 * unavailable rather than rendered from a stale copy.
 */
export function CartPage() {
  const store = useStore();
  const lines = useCart((s) => s.lines);
  const remove = useCart((s) => s.remove);
  const setLines = useCart((s) => s.setLines);
  const customer = useCustomer();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  useDocumentTitle("Cart");

  const designIds = lines.flatMap((line) => line.designs.map((d) => d.designId));
  const designs = useDesigns(designIds);

  const navigate = useNavigate();
  const [params] = useSearchParams();
  const recoverToken = params.get("recover");
  const recover = useRecoverCart();
  const recoverAttempted = useRef(false);

  // Redeem a `/cart?recover=<token>` link from a reminder email. Replaces the
  // cart wholesale — the recovered one is what the shopper came here for.
  useEffect(() => {
    if (!recoverToken || recoverAttempted.current) return;
    recoverAttempted.current = true;

    recover.mutate(recoverToken, {
      onSuccess: ({ lines: recovered }) => {
        setLines(recovered);
        void navigate("/cart", { replace: true });
      },
    });
  }, [recoverToken, recover, setLines, navigate]);

  const price = (cents: number) => formatMoney(cents, store.currency, store.locale);
  const total = countPostcards(lines);
  const cost = (of: CartLine[]) => {
    const { domestic, international } = countPostcardsByDestination(of);
    return domestic * store.postcardPriceCents + international * (store.internationalPostcardPriceCents ?? 0);
  };
  const abroad = countPostcardsByDestination(lines).international;
  const known = designs.data;
  const missing = known ? designIds.filter((id) => !known.has(id)).length : 0;

  const checkout = useMutation({
    mutationFn: () => apiPost<{ url: string; orderId: string }>("/checkout", { lines }),
    onSuccess: ({ url }) => {
      // Leave the cart intact: it is cleared on the confirmation page, so
      // abandoning the Stripe page does not lose the basket.
      window.location.assign(url);
    },
    onError: (error: unknown) => {
      setCheckoutError(error instanceof ApiError ? error.message : "Checkout is unavailable right now.");
    },
  });

  return (
    <PageWrapper>
      <h1>Cart</h1>

      {recover.isError && (
        <Alert
          type="error"
          showIcon
          className={cx(styles.alert)}
          title={recover.error instanceof ApiError ? recover.error.message : "That recovery link could not be used."}
        />
      )}

      {missing > 0 && (
        <Alert
          type="warning"
          showIcon
          className={cx(styles.alert)}
          title={
            missing === 1
              ? "A design in your cart is no longer available. Remove that batch and make it again."
              : `${missing} designs in your cart are no longer available. Remove those batches and make them again.`
          }
        />
      )}

      {lines.length === 0 ? (
        <div className={styles.empty}>
          <p>Hmmmm, there's nothing in your cart yet.</p>
          <Link to="/create">
            <Button type="primary">Make a postcard</Button>
          </Link>
        </div>
      ) : (
        <>
          <ul className={styles.lines} aria-label="Cart">
            {lines.map((line, index) => {
              const count = countPostcards([line]);
              const dates = line.designs.map((d) => d.mailDate).sort();
              const first = dates[0]!;
              const last = dates[dates.length - 1]!;

              return (
                <li key={index} className={styles.line}>
                  <div className={styles.thumbs}>
                    {designs.isPending ? (
                      <Skeleton.Image active />
                    ) : (
                      line.designs.map((d) => (
                        <div key={d.designId} className={styles.thumb}>
                          <ProductImage image={designs.data?.get(d.designId)?.thumbnail ?? null} sizes="96px" decorative />
                        </div>
                      ))
                    )}
                  </div>

                  <div className={styles.details}>
                    <p className={styles.title}>
                      {line.designs.length} design{line.designs.length === 1 ? "" : "s"} to{" "}
                      {line.recipients.length} recipient{line.recipients.length === 1 ? "" : "s"}
                    </p>
                    <p className={styles.meta}>
                      {first === last
                        ? `Mailed ${formatMailDate(first, store.locale)}`
                        : `Mailed ${formatMailDate(first, store.locale)} to ${formatMailDate(last, store.locale)}`}
                    </p>
                    <details className={styles.recipients}>
                      <summary>Recipients</summary>
                      <ul>
                        {line.recipients.map((recipient, i) => (
                          <li key={i}>
                            <strong>{recipient.name}</strong>
                            <span className={styles.meta}>{formatRecipient(recipient, store.locale)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>

                  <div className={styles.lineTotal}>
                    <span>{price(cost([line]))}</span>
                    <span className={styles.meta}>
                      {countPostcardsByDestination([line]).international > 0
                        ? `${count} postcards, ${countPostcardsByDestination([line]).international} abroad`
                        : `${count} × ${price(store.postcardPriceCents)}`}
                    </span>
                  </div>

                  <Button
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => remove(index)}
                    aria-label={`Remove batch ${index + 1} from cart`}
                  />
                </li>
              );
            })}
          </ul>

          <div className={styles.summary}>
            <Link to="/create" className={styles.another}>
              <Button>Create another batch</Button>
            </Link>

            <div className={styles.subtotal}>
              <span>
                Subtotal · {total} postcard{total === 1 ? "" : "s"}
                {abroad > 0 ? ` (${abroad} abroad)` : ""}
              </span>
              <strong>{price(cost(lines))}</strong>
            </div>

            <p className={styles.note}>Discount codes can be entered at checkout.</p>

            {!customer.isPending && !customer.data ? (
              <p className={styles.note}>
                <Link to="/account/login" state={{ from: "/cart" }}>
                  Sign in
                </Link>{" "}
                to keep your recipients for next time and follow your orders.
              </p>
            ) : null}

            {checkoutError && <Alert type="error" showIcon className={cx(styles.alert)} title={checkoutError} />}

            <Button
              type="primary"
              size="large"
              loading={checkout.isPending}
              disabled={missing > 0}
              onClick={() => {
                setCheckoutError(null);
                checkout.mutate();
              }}
            >
              Check out
            </Button>
          </div>
        </>
      )}
    </PageWrapper>
  );
}
