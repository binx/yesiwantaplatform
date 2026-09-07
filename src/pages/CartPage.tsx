import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, InputNumber } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { ApiError, apiPost } from "@/lib/api";
import { formatMoney } from "@shared/money";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductImage } from "@/components/ui/ProductImage";
import { useCartLines } from "@/lib/useCartLines";
import { useStore } from "@/lib/useStore";
import { useCart, normalizeQuantity } from "@/store/cart";
import { cx } from "@/lib/cx";
import styles from "./CartPage.module.css";

export function CartPage() {
  const store = useStore();
  const { lines, subtotalCents, orphanedCount } = useCartLines();
  const setQuantity = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const checkout = useMutation({
    mutationFn: () =>
      apiPost<{ url: string; orderId: string }>("/checkout", {
        // Identifiers and quantities only — the server prices the order.
        lines: lines.map(({ line }) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          options: line.options,
        })),
        shippingRateId: null,
      }),
    onSuccess: ({ url }) => {
      // Leave the cart intact: it is cleared on the confirmation page, so
      // abandoning the Stripe page does not lose the basket.
      window.location.assign(url);
    },
    onError: (error: unknown) => {
      setCheckoutError(
        error instanceof ApiError ? error.message : "Checkout is unavailable right now.",
      );
    },
  });

  return (
    <PageWrapper>
      <h1>Cart</h1>

      {orphanedCount > 0 && (
        <Alert
          type="warning"
          showIcon
          className={cx(styles.alert)}
          title={
            orphanedCount === 1
              ? "An item in your cart is no longer available and has been hidden."
              : `${orphanedCount} items in your cart are no longer available and have been hidden.`
          }
        />
      )}

      {lines.length === 0 ? (
        <div className={styles.empty}>
          <p>Your cart is empty.</p>
          <Link to="/shop">
            <Button type="primary">Browse the shop</Button>
          </Link>
        </div>
      ) : (
        <>
          {/* Scroll container so the table never forces the page sideways. */}
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Total</th>
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ index, line, product, variant, image, lineTotalCents, stock }) => {
                  const chosen = Object.entries(line.options)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(", ");

                  return (
                    <tr key={`${line.productId}-${line.variantId}-${index}`}>
                      <td>
                        <div className={styles.product}>
                          <Link to={`/product/${product.slug}`} className={styles.thumb}>
                            <ProductImage image={image} ratio={1} sizes="96px" />
                          </Link>
                          <div>
                            <Link to={`/product/${product.slug}`} className={styles.productName}>
                              {product.name}
                            </Link>
                            {variant.label && <div className={styles.meta}>{variant.label}</div>}
                            {chosen && <div className={styles.meta}>{chosen}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <InputNumber
                          min={1}
                          {...(stock !== null ? { max: stock } : {})}
                          step={1}
                          precision={0}
                          value={line.quantity}
                          onChange={(value) => setQuantity(index, normalizeQuantity(value, stock))}
                          aria-label={`Quantity for ${product.name}`}
                          className={cx(styles.qty)}
                        />
                      </td>
                      <td className={styles.lineTotal}>
                        {formatMoney(lineTotalCents, store.currency)}
                      </td>
                      <td>
                        {/* A real button: v1 used a bare <span>, so removing an
                            item could not be done from the keyboard. */}
                        <Button
                          type="text"
                          icon={<DeleteOutlined />}
                          onClick={() => remove(index)}
                          aria-label={`Remove ${product.name} from cart`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.summary}>
            <div className={styles.subtotal}>
              <span>Subtotal</span>
              <strong>{formatMoney(subtotalCents, store.currency)}</strong>
            </div>
            <p className={styles.note}>Shipping and taxes are calculated at checkout.</p>
            {checkoutError && (
              <Alert
                type="error"
                showIcon
                className={cx(styles.alert)}
                title={checkoutError}
              />
            )}
            <Button
              type="primary"
              size="large"
              loading={checkout.isPending}
              onClick={() => {
                setCheckoutError(null);
                checkout.mutate();
              }}
            >
              Checkout
            </Button>
          </div>
        </>
      )}
    </PageWrapper>
  );
}
