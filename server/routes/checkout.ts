import { randomUUID } from "node:crypto";
import { Router } from "express";
import type Stripe from "stripe";
import { checkoutRequestSchema } from "../../shared/orders.js";
import { getSettings, listProducts } from "../../db/repository.js";
import {
  createPendingOrder,
  findOrderByCheckoutSession,
  type PendingOrderLine,
} from "../../db/orders-repository.js";
import { getShippingTable } from "../../db/shipping-repository.js";
import { countriesCovered } from "../../shared/shipping.js";
import { quoteShipping, type QuotedRate } from "./shipping.js";
import { env } from "../env.js";
import { httpError, writeRateLimit } from "../middleware.js";
import { getStripe } from "../stripe.js";
import { findCustomerById } from "../auth.js";

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

  // Only used when the cart did not name a destination; a store with no zones
  // configured keeps the previous behaviour of a small default list.
  const { zones } = await getShippingTable();
  const covered = countriesCovered(zones);
  const allowedCountries = covered.length > 0 ? covered : ["US", "CA", "GB", "AU", "NZ", "IE"];

  // Load every referenced product once, by id, from the live catalogue.
  const { products } = await listProducts({ liveOnly: true, limit: 200 });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  const orderLines: PendingOrderLine[] = [];
  let subtotalCents = 0;
  /*
   * Whether anything in this cart actually has to be posted.
   *
   * Tracked over the same loop that reads prices, from the catalogue rather
   * than the request, for the same reason: the buyer must not be able to
   * declare their order digital and skip address collection.
   */
  let hasPhysicalLine = false;

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

    if (product.kind === "physical") hasPhysicalLine = true;

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

  /*
   * Shipping.
   *
   * Resolved here, from the same `quoteShipping` the cart page called, so the
   * price shown before checkout is the price offered at Stripe. Offered inline
   * rather than as pre-created Stripe objects, so there is nothing to keep in
   * sync.
   *
   * v1 let the browser pick a shipping SKU, and invented a `{name:"FREE",
   * price:0}` one when it had none.
   */
  const destination = parsed.data.shipToCountry?.toUpperCase() ?? null;

  const quote =
    hasPhysicalLine && destination
      ? await quoteShipping(parsed.data.lines, destination)
      : { rates: [] as QuotedRate[] };

  // The buyer's choice goes first: Stripe preselects the first option, so this
  // is what makes the cart's selection survive the redirect.
  const ordered = [...quote.rates].sort((a, b) => {
    if (a.id === parsed.data.shippingRateId) return -1;
    if (b.id === parsed.data.shippingRateId) return 1;
    return 0;
  });

  const shippingOptions: Stripe.Checkout.SessionCreateParams.ShippingOption[] = ordered.map(
    (rate) => ({
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: rate.priceCents, currency },
        display_name: rate.name,
        // Only when tax is on. Declaring a behaviour on a store that collects
        // no tax says something about a number nobody is calculating.
        ...(settings.taxEnabled ? { tax_behavior: rate.taxBehavior } : {}),
      },
    }),
  );

  // Minted up front so it can travel in the session's metadata; the webhook
  // uses it to find this order without having to reconstruct the cart.
  const orderId = randomUUID();

  /*
   * A signed-in buyer's order is linked at creation, not guessed at from the
   * email Stripe hands back later — see the webhook's `handleCheckoutCompleted`
   * for the guest path, which only ever links by matching a *verified*
   * customer's address.
   */
  const customer = req.session.customerId ? await findCustomerById(req.session.customerId) : null;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: lineItems,
      currency,
      // Saves a signed-in buyer retyping what we already know.
      ...(customer ? { customer_email: customer.email } : {}),
      /*
       * Stripe hosts the whole redemption flow — the code field, validation,
       * expiry, usage caps — so codes are created in the Stripe dashboard and
       * Beluga only records what came off. Note that Stripe rejects this
       * alongside `discounts`; never set both.
       */
      allow_promotion_codes: true,
      /*
       * Tax, calculated by Stripe Tax, and only when the merchant has turned
       * it on — see the Settings copy for why that is a deliberate gate rather
       * than a default. `customer_update` is not optional here: with
       * `automatic_tax` on, a session that creates a customer is rejected
       * without it, and the rejection lands at session creation rather than at
       * payment. Loud and in test, which is the right place for it.
       */
      ...(settings.taxEnabled
        ? {
            automatic_tax: { enabled: true },
            customer_update: { shipping: "auto" as const },
          }
        : {}),
      /*
       * Locked to the country the rates were priced for.
       *
       * Letting the buyer change country at Stripe would let them keep a
       * domestic rate on an international address — the shipping equivalent of
       * trusting a price from the client. With no destination chosen we fall
       * back to the store's own list.
       */
      /*
       * A cart of downloads only gets no address collection and no shipping
       * options at all — not an empty list, the keys absent entirely. Asking a
       * buyer for a postal address to receive a PDF is the visible half of the
       * bug; the invisible half is that Stripe would then attach a shipping
       * address to an order that has nothing to ship.
       *
       * A mixed cart is unchanged: one physical line is enough to need an
       * address, and the rates it is offered were priced on that line alone.
       */
      ...(hasPhysicalLine
        ? {
            shipping_address_collection: {
              allowed_countries: destination ? [destination] : allowedCountries,
            },
            ...(shippingOptions.length > 0 ? { shipping_options: shippingOptions } : {}),
          }
        : {}),
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
    email: session.customer_details?.email ?? customer?.email ?? "",
    currency: settings.currency,
    subtotalCents,
    lines: orderLines,
    customerId: customer?.id ?? null,
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
    discountCents: order.discountCents,
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
