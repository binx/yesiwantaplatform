import { Router } from "express";
import {
  addressInputSchema,
  customerLoginInputSchema,
  customerProfileUpdateInputSchema,
  customerRegisterInputSchema,
  forgotPasswordInputSchema,
  resetPasswordInputSchema,
  verifyEmailInputSchema,
  type CustomerProfile,
} from "../../shared/account.js";
import {
  claimOrdersForCustomer,
  getOrderForCustomer,
  listOrdersForCustomer,
} from "../../db/orders-repository.js";
import {
  AddressNotFoundError,
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
} from "../../db/customers-repository.js";
import {
  EmailTakenError,
  TokenNotUsableError,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createCustomer,
  createEmailVerificationToken,
  createPasswordResetToken,
  findCustomerById,
  recordCustomerLogin,
  updateCustomerName,
  verifyCustomerLogin,
} from "../auth.js";
import { sendAccountEmail } from "../email.js";
import { env } from "../env.js";
import { csrfToken, httpError, loginRateLimit, requireCustomer, sessionOp, verifyCsrf, writeRateLimit } from "../middleware.js";

/**
 * Customer accounts — a public, unauthenticated-facing login surface.
 *
 * Mixes public routes (register, sign in, verify, password reset) with ones
 * that need a signed-in customer. The signed-in ones live on `meRouter`
 * below, gated by one `meRouter.use(requireCustomer)` — the same shape as
 * `adminRouter.use(requireAdmin, ...)` — rather than repeating the check
 * per-route. See docs/tasks/11-customer-accounts.md for the security posture
 * this is held to, in particular: a customer session must never satisfy
 * `requireAdmin`, and registration, login and password-reset-request must
 * respond identically whether the email is already in use.
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
 * just enumerated the store's customers. `createCustomer` hashes the password
 * before it discovers the email is taken, which is what keeps the two
 * branches' cost — not just their response — close to equal.
 */
accountRouter.post("/register", loginRateLimit, async (req, res) => {
  const parsed = customerRegisterInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be used.");
  }

  try {
    const id = await createCustomer(parsed.data.email, parsed.data.password, parsed.data.name);
    const token = await createEmailVerificationToken(id);
    const verifyUrl = new URL(`/account/verify?token=${token}`, env.PUBLIC_URL).toString();
    await sendAccountEmail("VerifyEmail", parsed.data.email, verifyUrl);
  } catch (error) {
    // Not re-thrown: the caller learns nothing different than the success
    // path below. See the enumeration note above.
    if (!(error instanceof EmailTakenError)) throw error;
  }

  res.status(204).end();
});

/* ----------------------------------------------------------------- verify */

/**
 * Redeem an email-verification link.
 *
 * This is the gate the whole feature turns on: orders are only ever claimed
 * for a customer *after* this succeeds. Signs the customer in on success, the
 * same convenience as accepting a staff invitation.
 */
accountRouter.post("/verify", loginRateLimit, async (req, res) => {
  const parsed = verifyEmailInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That verification link could not be used.");

  let customer: { id: string; email: string };
  try {
    customer = await consumeEmailVerificationToken(parsed.data.token);
  } catch (error) {
    if (error instanceof TokenNotUsableError) throw httpError(410, error.message);
    throw error;
  }

  await claimOrdersForCustomer(customer.id, customer.email);

  await sessionOp((done) => req.session.regenerate(done));
  req.session.customerId = customer.id;
  const token = csrfToken(req);
  await sessionOp((done) => req.session.save(done));

  res.json({ csrfToken: token });
});

/* ----------------------------------------------------------------- session */

accountRouter.post("/session", loginRateLimit, async (req, res) => {
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

// No `requireCustomer`: signing out with no session is a harmless no-op,
// exactly as the admin equivalent treats it.
accountRouter.delete("/session", async (req, res) => {
  await new Promise<void>((resolve) => {
    req.session.destroy(() => resolve());
  });

  res.clearCookie("beluga.sid");
  res.status(204).end();
});

/* ----------------------------------------------------------------- profile */

meRouter.get("/", async (req, res) => {
  const customer = await findCustomerById(req.session.customerId!);
  // The account was removed after the session was issued. Rare, but a stale
  // session must not keep answering for a customer who no longer exists.
  if (!customer) throw httpError(401, "Sign in required.");

  const profile: CustomerProfile = {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    emailVerified: customer.emailVerifiedAt !== null && customer.emailVerifiedAt !== undefined,
    createdAt: toEpochMs(customer.createdAt),
  };

  res.json(profile);
});

meRouter.put("/", async (req, res) => {
  const parsed = customerProfileUpdateInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "That name could not be used.");

  await updateCustomerName(req.session.customerId!, parsed.data.name);
  res.status(204).end();
});

/* ------------------------------------------------------------------ orders */

/** This customer's orders only — never a query parameter, never another id. */
meRouter.get("/orders", async (req, res) => {
  const page = await listOrdersForCustomer(req.session.customerId!);
  res.json(page.orders);
});

/**
 * One order, filtered by customer id in the query itself. Another customer's
 * order is a 404, not a 403 with the body already attached — see the
 * acceptance criteria in docs/tasks/11-customer-accounts.md.
 */
meRouter.get("/orders/:id", async (req, res) => {
  const order = await getOrderForCustomer(req.params.id, req.session.customerId!);
  if (!order) throw httpError(404, "No order found.");
  res.json(order);
});

/* --------------------------------------------------------------- addresses */

meRouter.get("/addresses", async (req, res) => {
  res.json(await listAddresses(req.session.customerId!));
});

meRouter.post("/addresses", async (req, res) => {
  const parsed = addressInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That address could not be used.");
  }

  const address = await createAddress(req.session.customerId!, parsed.data);
  res.status(201).json(address);
});

meRouter.put("/addresses/:id", async (req, res) => {
  const parsed = addressInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That address could not be used.");
  }

  try {
    res.json(await updateAddress(req.params.id, req.session.customerId!, parsed.data));
  } catch (error) {
    if (error instanceof AddressNotFoundError) throw httpError(404, error.message);
    throw error;
  }
});

meRouter.delete("/addresses/:id", async (req, res) => {
  try {
    await deleteAddress(req.params.id, req.session.customerId!);
    res.status(204).end();
  } catch (error) {
    if (error instanceof AddressNotFoundError) throw httpError(404, error.message);
    throw error;
  }
});

/* ---------------------------------------------------------------- password */

/**
 * Request a reset link. Always 204: an attacker must not learn whether an
 * email has an account by watching this route's response.
 */
accountRouter.post("/password/forgot", loginRateLimit, async (req, res) => {
  const parsed = forgotPasswordInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Enter a valid email address.");

  const token = await createPasswordResetToken(parsed.data.email);
  if (token) {
    const resetUrl = new URL(`/account/reset-password?token=${token}`, env.PUBLIC_URL).toString();
    await sendAccountEmail("ResetPassword", parsed.data.email, resetUrl);
  }

  res.status(204).end();
});

accountRouter.post("/password/reset", loginRateLimit, async (req, res) => {
  const parsed = resetPasswordInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be used.");
  }

  try {
    await consumePasswordResetToken(parsed.data.token, parsed.data.password);
  } catch (error) {
    if (error instanceof TokenNotUsableError) throw httpError(410, error.message);
    throw error;
  }

  res.status(204).end();
});

accountRouter.use(meRouter);
