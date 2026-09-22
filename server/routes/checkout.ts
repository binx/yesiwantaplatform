import { Router } from "express";
import { artistPath, subscribeInputSchema, subscribeResponseSchema } from "../../shared/platform.js";
import { getSettings } from "../../db/repository.js";
import { getArtist } from "../../db/artists-repository.js";
import { getMailingAddress, getStripeCustomerId, setMailingAddress, setStripeCustomerId } from "../../db/customers-repository.js";
import { countPaidMonthsForSubscriptions } from "../../db/orders-repository.js";
import {
  createIncompleteSubscription,
  findOpenSubscription,
  findSubscriptionByCheckoutSession,
  newSubscriptionId,
} from "../../db/subscriptions-repository.js";
import { findCustomerById } from "../auth.js";
import { env } from "../env.js";
import { httpError, requireCustomer, verifyCsrf, writeRateLimit } from "../middleware.js";
import { classifyStripeError, getStripe } from "../stripe.js";
import { toSubscription } from "../presenters.js";
import { verifyRecipient } from "../lob.js";

/**
 * Subscribing.
 *
 * The client sends an artist id and an address — never a price. The monthly
 * price is read from the artist's row here and handed to Stripe as an inline
 * recurring `price_data`, so a tampered request cannot change what anything
 * costs, and there is no Stripe Price to keep in step with the artist's
 * settings.
 *
 * Signed in only: a subscription has to belong to someone who can come back
 * and cancel it, and the address lives on their account.
 */
export const checkoutRouter: Router = Router();

checkoutRouter.post("/checkout/subscribe", writeRateLimit, verifyCsrf, requireCustomer, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) throw httpError(503, "Subscriptions aren't open yet: Stripe is not configured.");

  const parsed = subscribeInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be read.");

  const settings = await getSettings();
  if (!settings) throw httpError(503, "This platform has not been set up yet.");

  const customer = await findCustomerById(req.session.customerId!);
  if (!customer) throw httpError(401, "Sign in again.");

  const artist = await getArtist(parsed.data.artistId);
  if (!artist || artist.status !== "live") throw httpError(409, "That artist isn't taking subscribers right now.");
  if (artist.customerId === customer.id) throw httpError(409, "You can't subscribe to yourself, though it's a nice thought.");

  if (await findOpenSubscription(customer.id, artist.id)) {
    throw httpError(409, `You already get postcards from ${artist.name}. Manage it from your account.`);
  }

  // The address is checked against USPS and saved on the account, so the
  // next subscription starts from it. A refusal is a 400 the form can act on.
  const verification = await verifyRecipient(parsed.data.address);
  if (verification.deliverability === "undeliverable") {
    throw httpError(400, "USPS does not recognise that address. Check the street, city, state and ZIP.");
  }
  // Deliberately no check on the artist's Stripe onboarding: an artist may
  // take subscribers before it finishes, and the ledger holds their share.
  await setMailingAddress(customer.id, parsed.data.address);

  const currency = settings.currency.toLowerCase();
  const subscriptionId = newSubscriptionId();

  try {
    // One Stripe Customer per person, made on their first subscription and
    // reused, so their card and their invoices sit in one place.
    let stripeCustomerId = await getStripeCustomerId(customer.id);
    if (!stripeCustomerId) {
      const created = await stripe.customers.create(
        { email: customer.email, ...(customer.name ? { name: customer.name } : {}), metadata: { yiwap_customer_id: customer.id } },
        { idempotencyKey: `customer-${customer.id}` },
      );
      stripeCustomerId = created.id;
      await setStripeCustomerId(customer.id, stripeCustomerId);
    }

    const metadata = { yiwap_subscription_id: subscriptionId, yiwap_artist_id: artist.id, yiwap_customer_id: customer.id };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: artist.monthlyPriceCents,
              recurring: { interval: "month" },
              product_data: {
                name: `A monthly postcard from ${artist.name}`,
                description: `${artist.termMonths} of their postcards, one printed and mailed to you each month for ${artist.termMonths} months. Billed monthly; it ends on its own, or sooner if you cancel.`,
              },
            },
          },
        ],
        // No shipping address collection: the address was given above, is
        // held on the account, and is what every card is mailed to.
        success_url: `${env.PUBLIC_URL}/subscribe/confirm?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.PUBLIC_URL}${artistPath(artist.slug)}`,
        metadata,
        subscription_data: { metadata },
      },
      // Retries of this request reuse the same session rather than making a new one.
      { idempotencyKey: `subscribe-${subscriptionId}` },
    );

    if (!session.url) throw httpError(502, "Stripe did not return a checkout URL.");

    await createIncompleteSubscription({
      id: subscriptionId,
      customerId: customer.id,
      artistId: artist.id,
      checkoutSessionId: session.id,
      priceCents: artist.monthlyPriceCents,
      currency: settings.currency,
      termMonths: artist.termMonths,
      address: parsed.data.address,
    });

    res.json(subscribeResponseSchema.parse({ url: session.url, subscriptionId }));
  } catch (error) {
    const classified = classifyStripeError(error);
    if (classified) throw httpError(classified.status, classified.message);
    throw error;
  }
});

/**
 * Subscription lookup for the confirmation page.
 *
 * Keyed by the Stripe session id from the redirect, which is unguessable,
 * and answered only to the person who started it. The redirect is *not*
 * treated as proof of payment — the webhook is the authority — so a row still
 * `incomplete` here simply means the webhook has not landed yet.
 */
checkoutRouter.get("/checkout/:sessionId", requireCustomer, async (req, res) => {
  const subscription = await findSubscriptionByCheckoutSession(String(req.params.sessionId));
  if (!subscription || subscription.customerId !== req.session.customerId) throw httpError(404, "No subscription found for that checkout.");

  const [artist, paidMonths] = await Promise.all([getArtist(subscription.artistId), countPaidMonthsForSubscriptions([subscription.id])]);
  res.json(toSubscription(subscription, artist ?? undefined, 0, paidMonths.get(subscription.id) ?? 0));
});

/** The address on the account, prefilled into the subscribe form. Signed in only. */
checkoutRouter.get("/checkout/address/me", requireCustomer, async (req, res) => {
  res.json({ address: await getMailingAddress(req.session.customerId!) });
});
