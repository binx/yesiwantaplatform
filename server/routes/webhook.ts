import { Router, raw } from "express";
import type Stripe from "stripe";
import type { SubscriptionStatus } from "../../shared/platform.js";
import { getArtist, findArtistByStripeAccount } from "../../db/artists-repository.js";
import { findCustomerByStripeId } from "../../db/customers-repository.js";
import { findOrderByPaymentIntent, recordPaidInvoice, recordRefund } from "../../db/orders-repository.js";
import {
  activateSubscription,
  deleteIncompleteSubscription,
  findSubscriptionByCheckoutSession,
  findSubscriptionByStripeId,
  getSubscription,
  syncSubscription,
} from "../../db/subscriptions-repository.js";
import { countForArtists } from "../../db/artists-repository.js";
import { forgetWebhookEvent, recordWebhookEvent } from "../../db/webhooks-repository.js";
import { findCustomerById } from "../auth.js";
import { recordConnectStatus } from "../connect.js";
import { env } from "../env.js";
import { getStripe } from "../stripe.js";
import { sendNewSubscriberEmail, sendSubscriptionStartedEmail } from "../email.js";

/**
 * Stripe webhooks — the authority on whether anyone has paid.
 *
 * The success redirect is not proof of payment. Subscriptions only ever
 * become active here, after the signature has been verified; renewals are
 * only ever recorded here; and an artist's Connect account only ever becomes
 * payable here or from the studio's own refresh. Mounted before the JSON body
 * parser because signature verification needs the exact raw bytes.
 */
export const webhookRouter: Router = Router();

/**
 * Stripe moved `current_period_end` from the Subscription to its items in
 * the 2025 API versions. Read wherever it is; null when nowhere.
 */
export function periodEndOf(subscription: Stripe.Subscription): number | null {
  const loose = subscription as unknown as { current_period_end?: number; items?: { data?: { current_period_end?: number }[] } };
  const seconds = loose.items?.data?.[0]?.current_period_end ?? loose.current_period_end;
  return typeof seconds === "number" ? seconds * 1000 : null;
}

/** The same move for an invoice's subscription: `invoice.subscription` became `invoice.parent.subscription_details.subscription`. */
export function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const loose = invoice as unknown as {
    subscription?: string | { id: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  const value = loose.parent?.subscription_details?.subscription ?? loose.subscription ?? null;
  return typeof value === "string" ? value : (value?.id ?? null);
}

/** Likewise the invoice's payment intent, for refunds to find their order later. */
function paymentIntentIdOf(invoice: Stripe.Invoice): string | null {
  const loose = invoice as unknown as { payment_intent?: string | { id: string } | null; payments?: { data?: { payment?: { payment_intent?: string | { id: string } | null } }[] } };
  const value = loose.payments?.data?.[0]?.payment?.payment_intent ?? loose.payment_intent ?? null;
  return typeof value === "string" ? value : (value?.id ?? null);
}

/** Stripe's subscription statuses, folded into ours. Null means "leave it alone". */
export function toOurStatus(status: Stripe.Subscription.Status): SubscriptionStatus | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return null;
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "subscription") return;
  const ours = session.metadata?.yiwap_subscription_id;
  const subscription = ours ? await getSubscription(ours) : await findSubscriptionByCheckoutSession(session.id);
  if (!subscription) {
    console.error(`Webhook for unknown subscription (session ${session.id}).`);
    return;
  }
  // Already processed — a replay, or a second event for the same session.
  if (subscription.status !== "incomplete") return;

  const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!stripeSubscriptionId) {
    console.error(`Checkout ${session.id} completed with no subscription on it.`);
    return;
  }

  // The period end is not on the session; it is on the subscription.
  const stripe = getStripe();
  let currentPeriodEnd: number | null = null;
  if (stripe) {
    try {
      currentPeriodEnd = periodEndOf(await stripe.subscriptions.retrieve(stripeSubscriptionId));
    } catch (error) {
      // Not fatal: `invoice.paid` carries the period too and lands right after.
      console.warn(`Could not read the period of ${stripeSubscriptionId}:`, (error as Error).message);
    }
  }

  if (!(await activateSubscription(subscription.id, { stripeSubscriptionId, currentPeriodEnd }))) return;

  const [artist, customer] = await Promise.all([getArtist(subscription.artistId), findCustomerById(subscription.customerId)]);
  if (!artist) return;

  if (customer) {
    await sendSubscriptionStartedEmail(customer.email, {
      artistName: artist.name,
      artistSlug: artist.slug,
      priceCents: subscription.priceCents,
      currency: subscription.currency,
      sendDay: artist.sendDay,
    });
  }

  const owner = await findCustomerById(artist.customerId);
  if (owner) {
    const counts = await countForArtists([artist.id]);
    await sendNewSubscriberEmail(owner.email, {
      artistName: artist.name,
      subscriberName: subscription.address.name,
      subscriberCity: subscription.address.city,
      subscriberCount: counts.get(artist.id)?.subscribers ?? 1,
    });
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const ours = session.metadata?.yiwap_subscription_id;
  const subscription = ours ? await getSubscription(ours) : await findSubscriptionByCheckoutSession(session.id);
  // Nothing was charged, so this is just tidying up.
  if (subscription && subscription.status === "incomplete") await deleteIncompleteSubscription(subscription.id);
}

/** A month paid for: the receipt row, and the subscription stays (or becomes) active. */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubscriptionId = subscriptionIdOf(invoice);
  if (!stripeSubscriptionId) return;

  const subscription = await findSubscriptionByStripeId(stripeSubscriptionId);
  if (!subscription) {
    // The first invoice can land before `checkout.session.completed` has
    // written the Stripe id onto the row. Stripe retries; the second attempt finds it.
    throw new Error(`invoice.paid for ${stripeSubscriptionId} before its subscription was activated.`);
  }

  const line = invoice.lines?.data?.[0];
  const periodStart = line?.period?.start ? line.period.start * 1000 : null;
  const periodEnd = line?.period?.end ? line.period.end * 1000 : null;

  await recordPaidInvoice({
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    artistId: subscription.artistId,
    stripeInvoiceId: invoice.id ?? `invoice-${subscription.id}-${periodStart ?? Date.now()}`,
    stripePaymentIntentId: paymentIntentIdOf(invoice),
    amountCents: invoice.amount_paid ?? 0,
    currency: (invoice.currency ?? subscription.currency).toUpperCase(),
    periodStart,
    periodEnd,
  });

  if (subscription.status !== "cancelled") {
    await syncSubscription(subscription.id, { status: "active", currentPeriodEnd: periodEnd ?? subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd });
  }
}

/** A renewal failed. Stripe retries on its own schedule; until it clears, no cards. */
async function handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const stripeSubscriptionId = subscriptionIdOf(invoice);
  if (!stripeSubscriptionId) return;
  const subscription = await findSubscriptionByStripeId(stripeSubscriptionId);
  if (!subscription || subscription.status === "cancelled") return;
  await syncSubscription(subscription.id, { status: "past_due", currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd });
}

/** Mirror whatever Stripe now says: status, period, and whether it is winding down. */
async function handleSubscriptionChanged(stripeSubscription: Stripe.Subscription): Promise<void> {
  const subscription = await findSubscriptionByStripeId(stripeSubscription.id);
  if (!subscription) return;
  const status = toOurStatus(stripeSubscription.status);
  if (!status) return;
  await syncSubscription(subscription.id, {
    status,
    currentPeriodEnd: periodEndOf(stripeSubscription) ?? subscription.currentPeriodEnd,
    cancelAtPeriodEnd: status === "cancelled" ? false : Boolean(stripeSubscription.cancel_at_period_end),
  });
}

/** An artist's Connect account changed: the one flag the ledger checks is mirrored. */
async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  const artist = await findArtistByStripeAccount(account.id);
  if (!artist) return;
  await recordConnectStatus(artist, account);
}

async function handleRefund(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return;
  const order = await findOrderByPaymentIntent(paymentIntentId);
  if (!order) return;

  // `amount_refunded` is the running total on the charge, not the delta for
  // this event, so record the difference against what we already knew.
  const delta = charge.amount_refunded - order.refundedCents;
  await recordRefund(order.id, delta, charge.amount_refunded >= charge.amount);
}

webhookRouter.post("/webhooks/stripe", raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  const stripe = getStripe();
  const signature = req.get("stripe-signature");

  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Webhooks are not configured." });
    return;
  }
  if (!signature) {
    res.status(400).json({ error: "Missing Stripe signature." });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.warn("Rejected a webhook with an invalid signature:", (error as Error).message);
    res.status(400).json({ error: "Invalid signature." });
    return;
  }

  // Stripe delivers at least once. Without this, a retry would send a
  // duplicate welcome email.
  const isNew = await recordWebhookEvent(event.id, event.type);
  if (!isNew) {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "checkout.session.expired":
        await handleCheckoutExpired(event.data.object);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;
      case "invoice.payment_failed":
        await handleInvoiceFailed(event.data.object);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChanged(event.data.object);
        break;
      case "account.updated":
        await handleAccountUpdated(event.data.object);
        break;
      case "charge.refunded":
        await handleRefund(event.data.object);
        break;
      default:
        // Unhandled types are acknowledged so Stripe stops retrying them.
        break;
    }
  } catch (error) {
    // Release the dedup record before answering 500, otherwise Stripe's
    // retry would be dismissed as a duplicate.
    await forgetWebhookEvent(event.id);

    console.error(`Failed handling ${event.type} (${event.id}):`, error);
    res.status(500).json({ error: "Handler failed." });
    return;
  }

  res.json({ received: true });
});

/** Exported for tests that need a customer from a Stripe id. */
export { findCustomerByStripeId };
