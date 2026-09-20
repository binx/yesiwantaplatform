import { Router } from "express";
import {
  customerLoginInputSchema,
  customerProfileUpdateInputSchema,
  customerRegisterInputSchema,
  forgotPasswordInputSchema,
  mailingAddressInputSchema,
  resetPasswordInputSchema,
  verifyEmailInputSchema,
  type CustomerProfile,
  type CustomerSession,
} from "../../shared/account.js";
import { getMailingAddress, setMailingAddress } from "../../db/customers-repository.js";
import { findArtistByCustomer, findArtistsByIds } from "../../db/artists-repository.js";
import {
  countPostcardsForSubscriptions,
  getSubscriptionForCustomer,
  listSubscriptionsForCustomer,
  setCancelAtPeriodEnd,
  updateSubscriptionAddresses,
} from "../../db/subscriptions-repository.js";
import { listPostcardsForCustomer } from "../../db/postcards-repository.js";
import { getMailing, type MailingRecord } from "../../db/mailings-repository.js";
import { listOrdersForCustomer } from "../../db/orders-repository.js";
import {
  EmailTakenError,
  TokenNotUsableError,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createCustomer,
  destroySessionsForCustomer,
  createEmailVerificationToken,
  createPasswordResetToken,
  findCustomerById,
  recordCustomerLogin,
  updateCustomerName,
  verifyCustomerLogin,
} from "../auth.js";
import { sendAccountEmail } from "../email.js";
import { verifyRecipient } from "../lob.js";
import { env } from "../env.js";
import { classifyStripeError, requireStripe, StripeNotConfiguredError } from "../stripe.js";
import { presentReceivedPostcards, toOrder, toSubscription } from "../presenters.js";
import {
  csrfToken,
  customerLoginRateLimit,
  emailRateLimit,
  httpError,
  requireCustomer,
  sessionOp,
  verifyCsrf,
  writeRateLimit,
} from "../middleware.js";

/**
 * Customer accounts — a public, unauthenticated-facing login surface.
 *
 * Mixes public routes (register, sign in, verify, password reset) with ones
 * that need a signed-in customer. The signed-in ones live on `meRouter`
 * below, gated by one `meRouter.use(requireCustomer)` — the same shape as
 * `adminRouter.use(requireAdmin, ...)`. A customer session must never
 * satisfy `requireAdmin`, and registration, login and password-reset-request
 * must respond identically whether the email is already in use.
 */
export const accountRouter: Router = Router();

// A broad ceiling on the whole router, same reasoning as the admin router's.
// verifyCsrf is a no-op on GET/HEAD/OPTIONS, so applying it here does not
// block the public reads below.
accountRouter.use(writeRateLimit, verifyCsrf);

const meRouter: Router = Router();
meRouter.use(requireCustomer);

function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  return Date.now();
}

/* --------------------------------------------------------------- register */

/**
 * Create an account.
 *
 * The response is identical whichever branch runs below: an attacker who can
 * tell registering with `victim@example.com` apart from a fresh address has
 * just enumerated the platform's users. `createCustomer` hashes the password
 * before it discovers the email is taken, which is what keeps the two
 * branches' cost — not just their response — close to equal.
 */
accountRouter.post("/register", emailRateLimit, async (req, res) => {
  const parsed = customerRegisterInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be used.");
  }

  try {
    const id = await createCustomer(parsed.data.email, parsed.data.password, parsed.data.name);
    const token = await createEmailVerificationToken(id);
    const verifyUrl = new URL("/account/verify", env.PUBLIC_URL);
    verifyUrl.searchParams.set("token", token);
    if (parsed.data.next) verifyUrl.searchParams.set("next", parsed.data.next);
    void sendAccountEmail("VerifyEmail", parsed.data.email, verifyUrl.toString());
  } catch (error) {
    // Not re-thrown: the caller learns nothing different than the success
    // path below. See the enumeration note above.
    if (!(error instanceof EmailTakenError)) throw error;
  }

  res.status(204).end();
});

/* ----------------------------------------------------------------- verify */

/** Redeem an email-verification link. Signs the customer in on success. */
accountRouter.post("/verify", customerLoginRateLimit, async (req, res) => {
  const parsed = verifyEmailInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That verification link could not be used.");

  let customer: { id: string; email: string };
  try {
    customer = await consumeEmailVerificationToken(parsed.data.token);
  } catch (error) {
    if (error instanceof TokenNotUsableError) throw httpError(410, error.message);
    throw error;
  }

  await sessionOp((done) => req.session.regenerate(done));
  req.session.customerId = customer.id;
  const token = csrfToken(req);
  await sessionOp((done) => req.session.save(done));

  res.json({ csrfToken: token });
});

/* ----------------------------------------------------------------- session */

accountRouter.post("/session", customerLoginRateLimit, async (req, res) => {
  const parsed = customerLoginInputSchema.safeParse(req.body);
  // Deliberately vague, matching the admin login: do not reveal which field
  // was wrong.
  if (!parsed.success) throw httpError(400, "Email and password are required.");

  const customer = await verifyCustomerLogin(parsed.data.email, parsed.data.password);
  if (!customer) throw httpError(401, "Incorrect email or password.");

  // Prevent session fixation: a new id is issued on privilege change.
  await sessionOp((done) => req.session.regenerate(done));
  req.session.customerId = customer.id;
  const token = csrfToken(req);
  await sessionOp((done) => req.session.save(done));

  // Best-effort, as with the admin equivalent: nobody should be locked out
  // because a timestamp write failed.
  await recordCustomerLogin(customer.id).catch(() => {});

  res.json({ csrfToken: token });
});

// No `requireCustomer`: signing out with no session is a harmless no-op.
accountRouter.delete("/session", async (req, res) => {
  await new Promise<void>((resolve) => {
    req.session.destroy(() => resolve());
  });

  res.clearCookie("yiwap.sid");
  res.status(204).end();
});

/* ----------------------------------------------------------------- profile */

/**
 * Who is signed in, if anyone.
 *
 * Deliberately *not* on `meRouter`: this is the probe every page makes on
 * first paint, and for a signed-out visitor "nobody" is the ordinary answer,
 * not a refusal.
 */
accountRouter.get("/", async (req, res) => {
  const id = req.session.customerId;
  const customer = id ? await findCustomerById(id) : null;

  const [address, artist] = customer ? await Promise.all([getMailingAddress(customer.id), findArtistByCustomer(customer.id)]) : [null, null];
  const profile: CustomerProfile | null = customer
    ? {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        emailVerified: customer.emailVerifiedAt !== null && customer.emailVerifiedAt !== undefined,
        createdAt: toEpochMs(customer.createdAt),
        address,
        artistSlug: artist?.slug ?? null,
      }
    : null;

  res.json({ customer: profile } satisfies CustomerSession);
});

meRouter.put("/", async (req, res) => {
  const parsed = customerProfileUpdateInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That name could not be used.");

  await updateCustomerName(req.session.customerId!, parsed.data.name);
  res.status(204).end();
});

/* ----------------------------------------------------------------- address */

/**
 * Where the cards go. Saved on the account and copied onto every open
 * subscription, so a subscriber who moves changes one thing. Checked against
 * USPS on the way in; a refusal is a 400 with the suggestion attached, so
 * the form can offer USPS's spelling rather than just saying no.
 */
meRouter.put("/address", async (req, res) => {
  const parsed = mailingAddressInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That address could not be used.");

  const verification = await verifyRecipient(parsed.data);
  if (verification.deliverability === "undeliverable") {
    throw httpError(400, "USPS does not recognise that address. Check the street, city, state and ZIP.");
  }

  await setMailingAddress(req.session.customerId!, parsed.data);
  await updateSubscriptionAddresses(req.session.customerId!, parsed.data);
  res.json({ address: parsed.data, verification });
});

/* ----------------------------------------------------------- subscriptions */

/** This customer's subscriptions only — never a query parameter, never another id. */
meRouter.get("/subscriptions", async (req, res) => {
  const subscriptions = await listSubscriptionsForCustomer(req.session.customerId!);
  const [artists, counts] = await Promise.all([
    findArtistsByIds(subscriptions.map((s) => s.artistId)),
    countPostcardsForSubscriptions(subscriptions.map((s) => s.id)),
  ]);
  const artistById = new Map(artists.map((a) => [a.id, a]));
  res.json(subscriptions.map((s) => toSubscription(s, artistById.get(s.artistId), counts.get(s.id) ?? 0)));
});

function stripeHttp(error: unknown): never {
  if (error instanceof StripeNotConfiguredError) throw httpError(503, error.message);
  const classified = classifyStripeError(error);
  if (classified) throw httpError(classified.status, classified.message);
  throw error;
}

/**
 * Stop at the end of the paid month. Stripe is told first and the row
 * mirrors it; the `customer.subscription.updated` webhook confirms. Cards
 * already scheduled in this period still go out — the month was paid for.
 */
meRouter.post("/subscriptions/:id/cancel", async (req, res) => {
  const subscription = await getSubscriptionForCustomer(req.params.id, req.session.customerId!);
  if (!subscription) throw httpError(404, "No subscription found.");
  if (subscription.status === "cancelled" || !subscription.stripeSubscriptionId) throw httpError(409, "That subscription is already over.");

  try {
    await requireStripe().subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true });
  } catch (error) {
    stripeHttp(error);
  }
  await setCancelAtPeriodEnd(subscription.id, true);
  res.status(204).end();
});

/** Changed their mind before the month ran out. */
meRouter.post("/subscriptions/:id/resume", async (req, res) => {
  const subscription = await getSubscriptionForCustomer(req.params.id, req.session.customerId!);
  if (!subscription) throw httpError(404, "No subscription found.");
  if (subscription.status === "cancelled" || !subscription.stripeSubscriptionId) throw httpError(409, "That subscription is over. Subscribe again from the artist's page.");

  try {
    await requireStripe().subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: false });
  } catch (error) {
    stripeHttp(error);
  }
  await setCancelAtPeriodEnd(subscription.id, false);
  res.status(204).end();
});

/* --------------------------------------------------------------- postcards */

/** Every card mailed to this person, newest first, with where each one is. */
meRouter.get("/postcards", async (req, res) => {
  const cards = await listPostcardsForCustomer(req.session.customerId!);
  const mailings = new Map<string, MailingRecord>();
  for (const id of new Set(cards.map((card) => card.mailingId))) {
    const mailing = await getMailing(id);
    if (mailing) mailings.set(id, mailing);
  }
  res.json(await presentReceivedPostcards(cards, mailings));
});

/* ------------------------------------------------------------------ orders */

/** Receipts: one per month paid, per subscription. */
meRouter.get("/orders", async (req, res) => {
  const orders = await listOrdersForCustomer(req.session.customerId!);
  const artists = await findArtistsByIds(orders.map((o) => o.artistId));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  res.json(orders.map((order) => toOrder(order, artistById.get(order.artistId))));
});

/* ---------------------------------------------------------------- password */

/**
 * Request a reset link. Always 204: an attacker must not learn whether an
 * email has an account by watching this route's response.
 */
accountRouter.post("/password/forgot", emailRateLimit, async (req, res) => {
  const parsed = forgotPasswordInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Enter a valid email address.");

  const token = await createPasswordResetToken(parsed.data.email);
  if (token) {
    const resetUrl = new URL(`/account/reset-password?token=${token}`, env.PUBLIC_URL).toString();
    void sendAccountEmail("ResetPassword", parsed.data.email, resetUrl);
  }

  res.status(204).end();
});

accountRouter.post("/password/reset", customerLoginRateLimit, async (req, res) => {
  const parsed = resetPasswordInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be used.");
  }

  let customerId: string;
  try {
    customerId = await consumePasswordResetToken(parsed.data.token, parsed.data.password);
  } catch (error) {
    if (error instanceof TokenNotUsableError) throw httpError(410, error.message);
    throw error;
  }

  // A reset is what someone does when they suspect their account is in use by
  // somebody else. Leaving that somebody signed in would defeat the point.
  await destroySessionsForCustomer(customerId);

  res.status(204).end();
});

accountRouter.use(meRouter);
