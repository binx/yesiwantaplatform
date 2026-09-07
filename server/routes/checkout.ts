import { randomUUID } from "node:crypto";
import { Router } from "express";
import type Stripe from "stripe";
import { checkoutRequestSchema } from "../../shared/orders.js";
import { getSettings, listProducts } from "../../db/repository.js";
import {
  createPendingOrder,
  findOrderByCheckoutSession,
  listShippingRates,
  type PendingOrderLine,
} from "../../db/orders-repository.js";
import { env } from "../env.js";
import { httpError, writeRateLimit } from "../middleware.js";
import { getStripe } from "../stripe.js";

/**
 * Checkout.
 *
 * The client sends product and variant identifiers with quantities — never a
 * price. Every amount charged is read from the database and turned into Stripe
 * line items here, so a tampered cart cannot change what anything costs.
 *
 * v1 posted `type: "sku"` line items to the removed Orders API and let the
 * browser choose the shipping SKU.
 */
export const checkoutRouter: Router = Router();

checkoutRouter.post("/checkout", writeRateLimit, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    throw httpError(503, "This store cannot take payments yet: Stripe is not configured.");
  }

  const parsed = checkoutRequestSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That cart could not be read.");

  const settings = await getSettings();
  if (!settings) throw httpError(503, "This store has not been set up yet.");

  const currency = settings.currency.toLowerCase();

  // Load every referenced product once, by id, from the live catalogue.
  const { products } = await listProducts({ liveOnly: true, limit: 200 });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  const orderLines: PendingOrderLine[] = [];
  let subtotalCents = 0;

  for (const line of parsed.data.lines) {
    const product = byId.get(line.productId);
    if (!product) throw httpError(409, "An item in your cart is no longer available.");

    const variant = product.variants.find((v) => v.id === line.variantId);
    if (!variant) throw httpError(409, `"${product.name}" no longer has that option.`);

    // Stock is checked here and again, authoritatively, when the webhook
    // confirms payment.
    if (variant.inventory.type === "finite" && variant.inventory.quantity < line.quantity) {
      throw httpError(
        409,
        variant.inventory.quantity === 0
          ? `"${product.name}" has sold out.`
          : `Only ${variant.inventory.quantity} of "${product.name}" left.`,
      );
    }

    if (!variant.stripePriceId) {
      throw httpError(
        409,
        `"${product.name}" is not published to Stripe yet, so it cannot be sold.`,
      );
    }

    lineItems.push({ price: variant.stripePriceId, quantity: line.quantity });

    orderLines.push({
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantLabel: variant.label,
      // From the database, not the request.
      unitPriceCents: variant.priceCents,
      quantity: line.quantity,
      options: line.options,
    });

    subtotalCents += variant.priceCents * line.quantity;
  }

  // Shipping is offered inline rather than as pre-created Stripe objects, so
  // there is nothing to keep in sync.
  const rates = await listShippingRates();
  const shippingOptions: Stripe.Checkout.SessionCreateParams.ShippingOption[] = rates.map(
    (rate) => ({
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: rate.priceCents, currency },
        display_name: rate.name,
      },
    }),
  );

  // Minted up front so it can travel in the session's metadata; the webhook
  // uses it to find this order without having to reconstruct the cart.
  const orderId = randomUUID();

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: lineItems,
      currency,
      // Stripe collects the address, so the storefront no longer owns a
      // four-pane address form (and its validation bugs).
      shipping_address_collection: { allowed_countries: ["US", "CA", "GB", "AU", "NZ", "IE"] },
      ...(shippingOptions.length > 0 ? { shipping_options: shippingOptions } : {}),
      success_url: `${env.PUBLIC_URL}/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.PUBLIC_URL}/cart`,
      metadata: { beluga_order_id: orderId },
      payment_intent_data: { metadata: { beluga_order_id: orderId } },
    },
    // Retries of this request reuse the same session rather than making a new
    // one; the order id is unique per attempt.
    { idempotencyKey: orderId },
  );

  if (!session.url) throw httpError(502, "Stripe did not return a checkout URL.");

  await createPendingOrder({
    id: orderId,
    checkoutSessionId: session.id,
    email: session.customer_details?.email ?? "",
    currency: settings.currency,
    subtotalCents,
    lines: orderLines,
  });

  res.json({ url: session.url, orderId });
});

/**
 * Order lookup for the confirmation page.
 *
 * Keyed by the Stripe session id from the redirect, which is unguessable, and
 * returns only what a buyer should see. The redirect is *not* treated as proof
 * of payment — the webhook is the authority — so an order still showing
 * "pending" here simply means the webhook has not landed yet.
 */
checkoutRouter.get("/checkout/:sessionId", async (req, res) => {
  const order = await findOrderByCheckoutSession(req.params.sessionId);
  if (!order) throw httpError(404, "No order found for that checkout.");

  res.json({
    reference: order.reference,
    email: order.email,
    status: order.status,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    items: order.items.map((i) => ({
      productName: i.productName,
      variantLabel: i.variantLabel,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      options: i.options,
    })),
  });
});

/** Shipping choices, shown on the cart page before checkout. */
checkoutRouter.get("/shipping-rates", async (_req, res) => {
  const rates = await listShippingRates();
  res.json(rates.map(({ id, name, priceCents }) => ({ id, name, priceCents })));
});
