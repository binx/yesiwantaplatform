import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  addressInputSchema,
  addressRequestInputSchema,
  customerLoginInputSchema,
  customerProfileUpdateInputSchema,
  customerRegisterInputSchema,
  forgotPasswordInputSchema,
  resetPasswordInputSchema,
  verifyEmailInputSchema,
  replySettingsInputSchema,
  type AddressRequest,
  type CustomerProfile,
  type CustomerSession,
} from "../../shared/account.js";
import { clearReplySettings, getReplySettings, setReplySettings } from "../../db/customers-repository.js";
import { disableReplyLink } from "../../db/orders-repository.js";
import {
  createAddressRequest,
  listAddressRequests,
  renewAddressRequest,
  revokeAddressRequest,
  type AddressRequestRecord,
} from "../../db/address-requests-repository.js";
import {
  claimOrdersForCustomer,
  getOrderForCustomer,
  listOrdersForCustomer,
  listPostcardsForDesign,
} from "../../db/orders-repository.js";
import {
  createDesign,
  deleteDraftDesign,
  getDesignForCustomer,
  listCopiesOf,
  listDesignsForCustomer,
  toPublicDesign,
  type GalleryDesign as GalleryDesignRow,
} from "../../db/designs-repository.js";
import { copyDesignFiles, deleteDesignFile } from "../uploads.js";
import type { GalleryDesign } from "../../shared/gallery.js";
import type { Postcard } from "../../shared/postcards.js";
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
import type { Order } from "../../shared/orders.js";
import { env } from "../env.js";
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

/**
 * An order as its buyer sees it: the same shape, minus Lob's error text and
 * attempt counts. Those are for the person who can act on them — the admin —
 * and a buyer whose card is stuck needs "we're looking into it", which is
 * what an `error` status renders as on the storefront, not a stack of
 * printer jargon.
 */
export function toCustomerOrder(order: Order): Order {
  return { ...order, postcards: order.postcards.map(toCustomerPostcard) };
}

/**
 * A card as its buyer may see it. A reply's recipient is the original
 * sender, whose address the replier must never see — the name they chose
 * stays, the rest is blank. This is the one gate; every customer-facing
 * order and gallery route goes through it.
 */
export function toCustomerPostcard(postcard: Postcard): Postcard {
  return {
    ...postcard,
    lastError: null,
    attempts: 0,
    recipient: postcard.isReply
      ? { ...postcard.recipient, line1: "", line2: null, city: "", state: "", postalCode: "", country: "US" }
      : postcard.recipient,
  };
}

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
accountRouter.post("/register", emailRateLimit, async (req, res) => {
  const parsed = customerRegisterInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be used.");
  }

  try {
    const id = await createCustomer(parsed.data.email, parsed.data.password, parsed.data.name);
    const token = await createEmailVerificationToken(id);
    const verifyUrl = new URL(`/account/verify?token=${token}`, env.PUBLIC_URL).toString();
    void sendAccountEmail("VerifyEmail", parsed.data.email, verifyUrl);
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

  await claimOrdersForCustomer(customer.id, customer.email);

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

/**
 * Who is signed in, if anyone.
 *
 * Deliberately *not* on `meRouter`: this is the probe every storefront page
 * makes on first paint, and for a signed-out shopper "nobody" is the ordinary
 * answer, not a refusal. Behind `requireCustomer` it answered 401, which the
 * client correctly read as `null` — and which the browser logged as a failed
 * request in the console of every page load, on a store where nothing was
 * wrong. Every other route below keeps `requireCustomer`.
 *
 * Registered ahead of `accountRouter.use(meRouter)` at the foot of this file,
 * so it is this handler that answers `GET /api/account`.
 */
accountRouter.get("/", async (req, res) => {
  const id = req.session.customerId;
  const customer = id ? await findCustomerById(id) : null;

  // A null customer covers both "signed out" and "the account was removed
  // after the session was issued" — the second is rare, and from the client's
  // side there is nothing to tell apart: neither is signed in.
  const reply = customer ? await getReplySettings(customer.id) : null;
  const profile: CustomerProfile | null = customer
    ? {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        emailVerified: customer.emailVerifiedAt !== null && customer.emailVerifiedAt !== undefined,
        createdAt: toEpochMs(customer.createdAt),
        replyDisplayName: reply?.displayName ?? null,
        replyAddress: reply?.address ?? null,
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

/* ------------------------------------------------------------------ orders */

/** This customer's orders only — never a query parameter, never another id. */
meRouter.get("/orders", async (req, res) => {
  const page = await listOrdersForCustomer(req.session.customerId!);
  res.json(page.orders.map(toCustomerOrder));
});

/**
 * One order, filtered by customer id in the query itself. Another customer's
 * order is a 404, not a 403 with the body already attached — see the
 * acceptance criteria in docs/tasks/11-customer-accounts.md.
 */
meRouter.get("/orders/:id", async (req, res) => {
  const order = await getOrderForCustomer(req.params.id, req.session.customerId!);
  if (!order) throw httpError(404, "No order found.");
  res.json(toCustomerOrder(order));
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

  // Verified here rather than trusting a flag from the client: the cache
  // makes the second look-up free, and "verified" then means Lob said so.
  const verification = await verifyRecipient(parsed.data);
  const address = await createAddress(req.session.customerId!, parsed.data, { verified: verification.deliverability === "deliverable", source: "manual" });
  res.status(201).json(address);
});

meRouter.put("/addresses/:id", async (req, res) => {
  const parsed = addressInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw httpError(400, parsed.error.issues[0]?.message ?? "That address could not be used.");
  }

  try {
    const verification = await verifyRecipient(parsed.data);
    res.json(await updateAddress(req.params.id, req.session.customerId!, parsed.data, { verified: verification.deliverability === "deliverable" }));
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

/* ----------------------------------------------------------------- replies */

/** Turn replies on: a name to show the recipient, and where a reply is mailed. */
meRouter.put("/reply-address", async (req, res) => {
  const parsed = replySettingsInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be used.");
  await setReplySettings(req.session.customerId!, parsed.data);
  res.status(204).end();
});

meRouter.delete("/reply-address", async (req, res) => {
  await clearReplySettings(req.session.customerId!);
  res.status(204).end();
});

/** Turn one card's code off. The page goes dark and the reply button disappears; a reply already paid for is unaffected. */
meRouter.post("/orders/:id/postcards/:postcardId/reply/disable", async (req, res) => {
  if (!(await disableReplyLink(req.params.id, req.params.postcardId, req.session.customerId!))) throw httpError(404, "No such postcard.");
  res.status(204).end();
});

/* ----------------------------------------------------------------- gallery */

function toGalleryDesign(design: GalleryDesignRow): GalleryDesign {
  return { ...toPublicDesign(design), ordered: design.orderId !== null, originId: design.originId, canSendAgain: design.canSendAgain, postcards: design.postcards };
}

meRouter.get("/designs", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
  const limit = Number(req.query.limit);
  const page = await listDesignsForCustomer(req.session.customerId!, { ...(cursor ? { cursor } : {}), ...(Number.isFinite(limit) ? { limit } : {}) });
  res.json({ designs: page.designs.map(toGalleryDesign), nextCursor: page.nextCursor });
});

/** One design with its cards. Another customer's design is a 404, like an order. */
meRouter.get("/designs/:id", async (req, res) => {
  const customerId = req.session.customerId!;
  const design = await getDesignForCustomer(req.params.id, customerId);
  if (!design) throw httpError(404, "No design found.");

  const [cards, copies] = await Promise.all([listPostcardsForDesign(design.id, customerId), listCopiesOf(design.id, customerId)]);
  res.json({ ...toGalleryDesign(design), cards: cards.map(toCustomerPostcard), copies: copies.map(toGalleryDesign) });
});

/**
 * "Send again": a fresh design with the same files and back, ready for the
 * designer. A design belongs to one order, so a copy rather than a reuse —
 * and the copy remembers where it came from.
 */
meRouter.post("/designs/:id/duplicate", async (req, res) => {
  const customerId = req.session.customerId!;
  const design = await getDesignForCustomer(req.params.id, customerId);
  if (!design) throw httpError(404, "No design found.");
  if (!design.printPath) throw httpError(409, "This design's print file is gone, so it can't be sent again. Save it as a new design instead.");

  const id = randomUUID();
  const files = await copyDesignFiles({ printPath: design.printPath, thumbnailPath: design.thumbnailPath }, id);
  try {
    const copy = await createDesign(
      {
        customerId,
        originId: design.originId ?? design.id,
        orientation: design.orientation,
        back: design.back,
        thumbnailWidth: design.thumbnailWidth,
        thumbnailHeight: design.thumbnailHeight,
        ...files,
      },
      id,
    );
    res.status(201).json(toPublicDesign(copy));
  } catch (error) {
    await deleteDesignFile(files.printPath).catch(() => undefined);
    await deleteDesignFile(files.thumbnailPath).catch(() => undefined);
    throw error;
  }
});

/** Drafts only: an ordered design is the record of what went out, and the order keeps a key to it. */
meRouter.delete("/designs/:id", async (req, res) => {
  const customerId = req.session.customerId!;
  const existing = await getDesignForCustomer(req.params.id, customerId);
  if (!existing) throw httpError(404, "No design found.");
  if (existing.orderId) throw httpError(409, "Ordered designs stay in your gallery.");

  const deleted = await deleteDraftDesign(existing.id, customerId);
  if (!deleted) throw httpError(409, "Ordered designs stay in your gallery.");
  if (deleted.printPath) await deleteDesignFile(deleted.printPath).catch(() => undefined);
  await deleteDesignFile(deleted.thumbnailPath).catch(() => undefined);
  res.status(204).end();
});

/* --------------------------------------------------------- address requests */

/** The link, minted here rather than in the repository, which knows nothing of PUBLIC_URL. */
function withUrl(record: AddressRequestRecord): AddressRequest {
  return {
    id: record.id,
    label: record.label,
    multi: record.multi,
    status: record.status,
    notifyByEmail: record.notifyByEmail,
    responses: record.responses,
    url: new URL(`/address/${record.token}`, env.PUBLIC_URL).toString(),
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

meRouter.get("/address-requests", async (req, res) => {
  res.json((await listAddressRequests(req.session.customerId!)).map(withUrl));
});

/**
 * Mint a link. The page a friend opens says who is asking, so the customer
 * needs a name first — "Someone would like your address" is not a page
 * anyone should fill in.
 */
meRouter.post("/address-requests", async (req, res) => {
  const parsed = addressRequestInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "That could not be used.");

  const customer = await findCustomerById(req.session.customerId!);
  if (!customer?.name?.trim()) throw httpError(409, "Add your name to your account first, so the person you ask knows who is asking.");

  res.status(201).json(withUrl(await createAddressRequest(customer.id, parsed.data)));
});

meRouter.post("/address-requests/:id/renew", async (req, res) => {
  const renewed = await renewAddressRequest(req.params.id, req.session.customerId!);
  if (!renewed) throw httpError(404, "No such link.");
  res.json(withUrl(renewed));
});

meRouter.delete("/address-requests/:id", async (req, res) => {
  if (!(await revokeAddressRequest(req.params.id, req.session.customerId!))) throw httpError(404, "No such link.");
  res.status(204).end();
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
