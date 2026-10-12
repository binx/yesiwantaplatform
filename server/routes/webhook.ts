import { Router, raw } from "express";
import type Stripe from "stripe";
import { editionSchedule } from "../../shared/platform.js";
import { getArtist, findArtistByStripeAccount } from "../../db/artists-repository.js";
import { findCustomerByStripeId } from "../../db/customers-repository.js";
import { getEdition, listCardsForEdition } from "../../db/editions-repository.js";
import {
  countCollectorsForEditions,
  deleteIncompletePurchase,
  findPurchaseByCheckoutSession,
  findPurchaseByPaymentIntent,
  getPurchase,
  markPurchasePaid,
  recordPurchaseRefund,
} from "../../db/purchases-repository.js";
import { cancelUnsentPostcards, materialisePostcards } from "../../db/postcards-repository.js";
import { forgetWebhookEvent, recordWebhookEvent } from "../../db/webhooks-repository.js";
import { findCustomerById } from "../auth.js";
import { recordConnectStatus } from "../connect.js";
import { env } from "../env.js";
import { kickSweep } from "../fulfilment.js";
import { getStripe } from "../stripe.js";
import { sendCollectionStartedEmail, sendNewCollectorEmail } from "../email.js";

/**
 * Stripe webhooks — the authority on whether anyone has paid.
 *
 * The success redirect is not proof of payment. A purchase only ever becomes
 * paid here, after the signature has been verified, and only here are its
 * cards written; refunds are only ever recorded here; and an artist's
 * Connect account only ever becomes payable here or from the studio's own
 * refresh. Mounted before the JSON body parser because signature
 * verification needs the exact raw bytes.
 */
export const webhookRouter: Router = Router();

function paymentIntentIdOf(session: Stripe.Checkout.Session): string | null {
  const value = session.payment_intent;
  return typeof value === "string" ? value : (value?.id ?? null);
}

async function findPurchaseForSession(session: Stripe.Checkout.Session) {
  const ours = session.metadata?.yiwap_purchase_id;
  return ours ? await getPurchase(ours) : await findPurchaseByCheckoutSession(session.id);
}

/**
 * Paid: the purchase is marked, and every card of the run is written on its
 * day.
 *
 * The mark comes first, so a card is never scheduled for a purchase that is
 * not paid. The cards are written whenever the purchase is paid, not only by
 * the request whose mark won: if writing them fails, the event is forgotten,
 * Stripe redelivers, the mark is already done, and the idempotent write
 * fills in what is missing. Only the winning mark sends the emails.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "payment") return;
  // An asynchronous payment method completes Checkout before the money
  // arrives; `checkout.session.async_payment_succeeded` is that moment.
  if (session.payment_status !== "paid") return;

  const purchase = await findPurchaseForSession(session);
  if (!purchase) {
    console.error(`Webhook for unknown purchase (session ${session.id}).`);
    return;
  }
  if (purchase.status === "refunded") return;

  const won = purchase.status === "incomplete" && (await markPurchasePaid(purchase.id, paymentIntentIdOf(session)));
  const paid = await getPurchase(purchase.id);
  if (!paid || paid.status !== "paid") return;

  const cards = await listCardsForEdition(paid.editionId);
  const written = await materialisePostcards(paid, cards);
  // A run that starts tomorrow does nothing today; one whose first day has
  // already come (a slow webhook) goes now rather than at the next tick.
  if (written > 0) kickSweep();
  if (!won) return;

  const [edition, artist, customer] = await Promise.all([getEdition(paid.editionId), getArtist(paid.artistId), findCustomerById(paid.customerId)]);
  if (!edition || !artist) return;

  if (customer) {
    await sendCollectionStartedEmail(customer.email, {
      artistName: artist.name,
      artistSlug: artist.slug,
      editionTitle: edition.title,
      priceCents: paid.priceCents,
      currency: paid.currency,
      cardCount: paid.cardCount,
      twiceMonthly: paid.cadence === "twice_monthly",
      schedule: editionSchedule(paid.startDate, paid.cardCount, paid.cadence),
    });
  }

  const owner = await findCustomerById(artist.customerId);
  if (owner) {
    const counts = await countCollectorsForEditions([edition.id]);
    await sendNewCollectorEmail(owner.email, {
      editionTitle: edition.title,
      collectorName: paid.address.name,
      collectorCity: paid.address.city,
      collectorCount: counts.get(edition.id) ?? 1,
    });
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const purchase = await findPurchaseForSession(session);
  // Nothing was charged, so this is just tidying up.
  if (purchase && purchase.status === "incomplete") await deleteIncompletePurchase(purchase.id);
}

/** An artist's Connect account changed: the one flag the ledger checks is mirrored. */
async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  const artist = await findArtistByStripeAccount(account.id);
  if (!artist) return;
  await recordConnectStatus(artist, account);
}

/**
 * Money given back. `amount_refunded` is the running total on the charge, so
 * it is stored as it is. A full refund withdraws every card not yet sent —
 * nobody is paying for them now — and those cards earn the artist nothing.
 * A partial refund is a gesture, and the cards keep coming.
 */
async function handleRefund(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return;
  const purchase = await findPurchaseByPaymentIntent(paymentIntentId);
  if (!purchase) return;

  const full = charge.amount_refunded >= charge.amount;
  await recordPurchaseRefund(purchase.id, charge.amount_refunded, full);
  if (full) await cancelUnsentPostcards(purchase.id);
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
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        await handleCheckoutExpired(event.data.object);
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
