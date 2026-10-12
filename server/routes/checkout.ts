import { Router } from "express";
import { collectInputSchema, collectResponseSchema, defaultStartDate, editionPath, editionSchedule, startDateProblem } from "../../shared/platform.js";
import { todayIso } from "../../shared/postcards.js";
import { getSettings } from "../../db/repository.js";
import { getArtist } from "../../db/artists-repository.js";
import { getEdition, listCardsForEdition } from "../../db/editions-repository.js";
import { getMailingAddress, getStripeCustomerId, setMailingAddress, setStripeCustomerId } from "../../db/customers-repository.js";
import { createIncompletePurchase, findPurchaseByCheckoutSession, findRunningPurchase, newPurchaseId } from "../../db/purchases-repository.js";
import { findCustomerById } from "../auth.js";
import { env } from "../env.js";
import { httpError, requireCustomer, verifyCsrf, writeRateLimit } from "../middleware.js";
import { classifyStripeError, getStripe } from "../stripe.js";
import { presentCollections } from "../presenters.js";
import { verifyRecipient } from "../lob.js";

/**
 * Collecting an edition.
 *
 * The client sends an edition id, an address and, if they like, the day the
 * first card should go — never a price. The price is read from the edition's
 * row here and handed to Stripe as an inline one-time `price_data`, so a
 * tampered request cannot change what anything costs, and there is no
 * Stripe Price to keep in step with the edition.
 *
 * Signed in only: a run of cards has to belong to someone who can come back
 * and see where it is, and the address lives on their account.
 */
export const checkoutRouter: Router = Router();

const CADENCE_WORDS = { monthly: "one a month", twice_monthly: "two a month" } as const;

checkoutRouter.post("/checkout/collect", writeRateLimit, verifyCsrf, requireCustomer, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) throw httpError(503, "Editions can't be collected yet: Stripe is not configured.");

  const parsed = collectInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be read.");

  const settings = await getSettings();
  if (!settings) throw httpError(503, "This platform has not been set up yet.");

  const customer = await findCustomerById(req.session.customerId!);
  if (!customer) throw httpError(401, "Sign in again.");

  const edition = await getEdition(parsed.data.editionId);
  const artist = edition ? await getArtist(edition.artistId) : null;
  if (!edition || !artist || edition.status !== "on_sale" || artist.status !== "live") throw httpError(409, "That edition isn't available right now.");
  if (artist.customerId === customer.id) throw httpError(409, "You can't collect your own edition, though it's a nice thought.");

  // A set missing a card would be a set that cannot be mailed. Going on sale
  // checks this; a card removed underneath it by hand must not be sold.
  const cards = await listCardsForEdition(edition.id);
  if (cards.length !== edition.cardCount) throw httpError(409, "That edition isn't available right now.");

  if (await findRunningPurchase(customer.id, edition.id)) {
    throw httpError(409, `You're already collecting ${edition.title}. You can collect it again once your last card has gone.`);
  }

  const today = todayIso();
  const startDate = parsed.data.startDate ?? defaultStartDate(today);
  const problem = startDateProblem(startDate, today);
  if (problem) throw httpError(400, problem);

  // The address is checked against USPS and saved on the account, so the
  // next purchase starts from it. A refusal is a 400 the form can act on.
  const verification = await verifyRecipient(parsed.data.address);
  if (verification.deliverability === "undeliverable") {
    throw httpError(400, "USPS does not recognise that address. Check the street, city, state and ZIP.");
  }
  // Deliberately no check on the artist's Stripe onboarding: an artist may
  // sell before it finishes, and the ledger holds their share.
  await setMailingAddress(customer.id, parsed.data.address);

  const currency = settings.currency.toLowerCase();
  const purchaseId = newPurchaseId();
  const schedule = editionSchedule(startDate, edition.cardCount, edition.cadence);

  try {
    // One Stripe Customer per person, made on their first purchase and
    // reused, so their card and their receipts sit in one place.
    let stripeCustomerId = await getStripeCustomerId(customer.id);
    if (!stripeCustomerId) {
      const created = await stripe.customers.create(
        { email: customer.email, ...(customer.name ? { name: customer.name } : {}), metadata: { yiwap_customer_id: customer.id } },
        { idempotencyKey: `customer-${customer.id}` },
      );
      stripeCustomerId = created.id;
      await setStripeCustomerId(customer.id, stripeCustomerId);
    }

    const metadata = { yiwap_purchase_id: purchaseId, yiwap_edition_id: edition.id, yiwap_artist_id: artist.id, yiwap_customer_id: customer.id };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer: stripeCustomerId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: edition.priceCents,
              product_data: {
                name: `${edition.title} — ${artist.name}`,
                description: `${edition.cardCount} postcards, ${CADENCE_WORDS[edition.cadence]}, printed and mailed to you from ${schedule[0]} to ${schedule[schedule.length - 1]}. Paid once.`,
              },
            },
          },
        ],
        // No shipping address collection: the address was given above, is
        // held on the account, and is what every card is mailed to.
        success_url: `${env.PUBLIC_URL}/collect/confirm?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.PUBLIC_URL}${editionPath(artist.slug, edition.slug)}`,
        metadata,
        payment_intent_data: { metadata },
      },
      // Retries of this request reuse the same session rather than making a new one.
      { idempotencyKey: `collect-${purchaseId}` },
    );

    if (!session.url) throw httpError(502, "Stripe did not return a checkout URL.");

    await createIncompletePurchase({
      id: purchaseId,
      customerId: customer.id,
      editionId: edition.id,
      artistId: artist.id,
      checkoutSessionId: session.id,
      priceCents: edition.priceCents,
      currency: settings.currency,
      cardCount: edition.cardCount,
      cadence: edition.cadence,
      startDate,
      address: parsed.data.address,
    });

    res.json(collectResponseSchema.parse({ url: session.url, purchaseId }));
  } catch (error) {
    const classified = classifyStripeError(error);
    if (classified) throw httpError(classified.status, classified.message);
    throw error;
  }
});

/** The address on the account, prefilled into the collect form. Signed in only. */
checkoutRouter.get("/checkout/address/me", requireCustomer, async (req, res) => {
  res.json({ address: await getMailingAddress(req.session.customerId!) });
});

/**
 * Purchase lookup for the confirmation page.
 *
 * Keyed by the Stripe session id from the redirect, which is unguessable,
 * and answered only to the person who started it. The redirect is *not*
 * treated as proof of payment — the webhook is the authority — so a row still
 * `incomplete` here simply means the webhook has not landed yet.
 */
checkoutRouter.get("/checkout/:sessionId", requireCustomer, async (req, res) => {
  const purchase = await findPurchaseByCheckoutSession(String(req.params.sessionId));
  if (!purchase || purchase.customerId !== req.session.customerId) throw httpError(404, "Nothing found for that checkout.");
  const [collection] = await presentCollections([purchase]);
  res.json(collection);
});
