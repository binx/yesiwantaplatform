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
import { findArtistByCustomer } from "../../db/artists-repository.js";
import { listPurchasesForCustomer, updatePurchaseAddress, updatePurchaseAddresses } from "../../db/purchases-repository.js";
import { listPostcardsForCustomer, updateUnsentPostcardAddresses } from "../../db/postcards-repository.js";
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
import { presentCollections, presentReceivedPostcards } from "../presenters.js";
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

/** USPS's verdict on an address, as the two routes below ask for it. A refusal is a 400 the form can act on. */
async function verifiedAddress(body: unknown) {
  const parsed = mailingAddressInputSchema.safeParse(body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That address could not be used.");
  const verification = await verifyRecipient(parsed.data);
  if (verification.deliverability === "undeliverable") {
    throw httpError(400, "USPS does not recognize that address. Check the street, city, state and ZIP.");
  }
  return { address: parsed.data, verification };
}

/**
 * Where the cards go. Saved on the account and copied onto every open
 * purchase that was going to the old address, and every card of theirs
 * still to come, so a collector who moves changes one thing. A set sent
 * somewhere else — a gift — stays where it is. Checked against USPS on the
 * way in; a refusal is a 400 with the suggestion attached, so the form can
 * offer USPS's spelling rather than just saying no.
 */
meRouter.put("/address", async (req, res) => {
  const { address, verification } = await verifiedAddress(req.body);
  const customerId = req.session.customerId!;
  const previous = await getMailingAddress(customerId);
  await setMailingAddress(customerId, address);
  const purchaseIds = await updatePurchaseAddresses(customerId, previous, address);
  await updateUnsentPostcardAddresses(purchaseIds, address);
  res.json({ address, verification });
});

/**
 * One collection goes somewhere else from now on: its cards still to come,
 * and nothing else of this person's. The account's own address is not
 * touched. Only the caller's own paid purchase: anyone else's, or one with
 * nothing still to come, is a 404.
 */
meRouter.put("/collections/:id/address", async (req, res) => {
  const { address, verification } = await verifiedAddress(req.body);
  const id = String(req.params.id);
  const moved = await updatePurchaseAddress(id, req.session.customerId!, address);
  if (!moved) throw httpError(404, "That isn't one of your collections.");
  await updateUnsentPostcardAddresses([id], address);
  res.json({ address, verification });
});

/* ------------------------------------------------------------- collections */

/**
 * This customer's purchases only — never a query parameter, never another
 * id. Each with its schedule, so the account can say when the next card goes.
 * It is also the receipt: what was paid, and what was refunded.
 */
meRouter.get("/collections", async (req, res) => {
  res.json(await presentCollections(await listPurchasesForCustomer(req.session.customerId!)));
});

/* --------------------------------------------------------------- postcards */

/** Every card mailed to this person, newest first, with where each one is. */
meRouter.get("/postcards", async (req, res) => {
  res.json(await presentReceivedPostcards(await listPostcardsForCustomer(req.session.customerId!)));
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
