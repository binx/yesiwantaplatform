import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, InputNumber, Radio, Select, Skeleton } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SHIPPABLE_COUNTRIES, countryName } from "@shared/shipping";
import { ApiError, apiPost } from "@/lib/api";
import { formatMoney } from "@shared/money";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductImage } from "@/components/ui/ProductImage";
import { useCartLines } from "@/lib/useCartLines";
import { useStore } from "@/lib/useStore";
import { useAddresses, useCustomer } from "@/lib/account";
import { useRecoverCart } from "@/lib/cart-recovery";
import { useCart, normalizeQuantity } from "@/store/cart";
import { cx } from "@/lib/cx";
import styles from "./CartPage.module.css";

export function CartPage() {
  const store = useStore();
  const { lines, subtotalCents, orphanedCount } = useCartLines();
  const setQuantity = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  const setLines = useCart((s) => s.setLines);
  const shipToCountry = useCart((s) => s.shipToCountry);
  const setShipToCountry = useCart((s) => s.setShipToCountry);
  const shippingRateId = useCart((s) => s.shippingRateId);
  const setShippingRateId = useCart((s) => s.setShippingRateId);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const customer = useCustomer();
  const addresses = useAddresses(Boolean(customer.data));
  const defaultAddress = addresses.data?.find((a) => a.isDefault) ?? null;

  const navigate = useNavigate();
  const [params] = useSearchParams();
  const recoverToken = params.get("recover");
  const recover = useRecoverCart();
  const recoverAttempted = useRef(false);

  /*
   * Redeem a `/cart?recover=<token>` link from a reminder email.
   *
   * Replaces the cart wholesale — the recovered one is what the shopper came
   * here for, not whatever this browser happened to already hold. Dropped
   * lines need no bespoke handling: they simply are not in the repopulated
   * cart, so the existing `orphanedCount` alert below never even sees them.
   */
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

  /*
   * A catch-all zone prices everywhere, so the picker has to offer everywhere —
   * otherwise "Rest of world" is a zone no buyer can select. Without one, the
   * only valid answers are the countries the store's zones actually name.
   */
  const destinations = store.shipping.worldwide
    ? SHIPPABLE_COUNTRIES
    : store.shipping.countries;
  const asksForCountry = destinations.length > 0;

  // Preselect when there is only one possible answer; asking then is noise.
  useEffect(() => {
    if (!shipToCountry && destinations.length === 1) setShipToCountry(destinations[0] ?? null);
  }, [shipToCountry, destinations, setShipToCountry]);

  // A signed-in buyer's saved address answers "ship to" before they type
  // anything — but only ever a country this store actually prices for.
  useEffect(() => {
    if (shipToCountry || !defaultAddress) return;
    if (destinations.includes(defaultAddress.country)) setShipToCountry(defaultAddress.country);
  }, [shipToCountry, defaultAddress, destinations, setShipToCountry]);

  const quoteLines = lines.map(({ line }) => ({
    productId: line.productId,
    variantId: line.variantId,
    quantity: line.quantity,
  }));

  /**
   * Shipping options for this cart and destination.
   *
   * Priced by the server from the catalogue, using the same resolution the
   * checkout route runs — so what is shown here is what Stripe will offer.
   */
  const quote = useQuery({
    queryKey: ["shipping-quote", shipToCountry, quoteLines],
    queryFn: () =>
      apiPost<{ rates: { id: string; name: string; priceCents: number }[]; gap: boolean }>(
        "/shipping/quote",
        { lines: quoteLines, countryCode: shipToCountry },
      ),
    enabled: Boolean(shipToCountry) && quoteLines.length > 0,
    staleTime: 60_000,
  });

  const rates = quote.data?.rates ?? [];
  const selectedRate = rates.find((rate) => rate.id === shippingRateId) ?? rates[0] ?? null;
  const shippingCents = selectedRate?.priceCents ?? null;

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
        shippingRateId: selectedRate?.id ?? null,
        shipToCountry,
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

      {recover.isError && (
        <Alert
          type="error"
          showIcon
          className={cx(styles.alert)}
          title={
            recover.error instanceof ApiError
              ? recover.error.message
              : "That recovery link could not be used."
          }
        />
      )}

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

            {/*
              * Destination is asked for here, not at Stripe.
              *
              * Hosted Checkout collects the address after the session exists,
              * so zone-priced shipping has to know the country first. The
              * session is then locked to this country, which is why the
              * question is worth asking up front rather than guessing.
              */}
            {asksForCountry ? (
              <label className={styles.shipTo}>
                <span className={styles.shipToLabel}>Ship to</span>
                <Select
                  className={cx(styles.shipToSelect)}
                  value={shipToCountry}
                  placeholder="Choose a country"
                  showSearch
                  optionFilterProp="label"
                  onChange={(code: string) => setShipToCountry(code)}
                  options={destinations.map((code) => ({
                    label: countryName(code),
                    value: code,
                  }))}
                />
              </label>
            ) : null}

            {asksForCountry && shipToCountry ? (
              quote.isPending ? (
                <Skeleton active paragraph={{ rows: 2 }} title={false} />
              ) : rates.length > 0 ? (
                <fieldset className={styles.shipping}>
                  <legend className={styles.shipToLabel}>Shipping</legend>
                  <Radio.Group
                    value={selectedRate?.id}
                    onChange={(event) => setShippingRateId(event.target.value as string)}
                    className={cx(styles.rates)}
                  >
                    {rates.map((rate) => (
                      <Radio key={rate.id} value={rate.id} className={cx(styles.rate)}>
                        <span>{rate.name}</span>
                        <span className={styles.ratePrice}>
                          {rate.priceCents === 0
                            ? "Free"
                            : formatMoney(rate.priceCents, store.currency)}
                        </span>
                      </Radio>
                    ))}
                  </Radio.Group>
                </fieldset>
              ) : (
                <p className={styles.note}>
                  No shipping option is configured for {countryName(shipToCountry)}. You can still
                  order; nothing will be charged for postage.
                </p>
              )
            ) : null}

            {shippingCents !== null ? (
              <div className={styles.subtotal}>
                <span>Total</span>
                <strong>{formatMoney(subtotalCents + shippingCents, store.currency)}</strong>
              </div>
            ) : null}

            <p className={styles.note}>
              {asksForCountry
                ? "Taxes, if any, are calculated at checkout."
                : "Shipping and taxes are calculated at checkout."}
            </p>
            {/*
              * Offered, never required — guest checkout stays the default
              * path. See docs/tasks/11-customer-accounts.md: forcing an
              * account ahead of checkout is a well-documented conversion
              * loss.
              */}
            {!customer.isPending && !customer.data ? (
              <p className={styles.note}>
                <Link to="/account/login" state={{ from: "/cart" }}>
                  Sign in
                </Link>{" "}
                for faster checkout and order tracking.
              </p>
            ) : null}
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
