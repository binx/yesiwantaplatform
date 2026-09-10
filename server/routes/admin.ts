import { Router } from "express";
import { ZodError } from "zod";
import {
  imageInputSchema,
  pageInputSchema,
  pagePreviewInputSchema,
  reorderInputSchema,
  passwordChangeInputSchema,
  settingsInputSchema,
  type EmailTestResult,
  type EnvironmentStatus,
  type LobTestResult,
} from "../../shared/api.js";
import { SlugTakenError, updateSettings } from "../../db/admin-repository.js";
import { getSettings } from "../../db/repository.js";
import {
  createPage,
  deletePage,
  listPageDrafts,
  pageExists,
  reorderPages,
  updatePage,
} from "../../db/pages-repository.js";
import {
  cancelOrder,
  cancelPostcard,
  completeOrderIfDone,
  countPostcardsByStatus,
  getOrder,
  getOrderPaymentIntentId,
  getPostcard,
  listOrders,
  requeuePostcard,
} from "../../db/orders-repository.js";
import { formatMoney } from "../../shared/money.js";
import { CSV_BOM, csvRow } from "../../shared/csv.js";
import { orderStatusSchema, refundInputSchema } from "../../shared/orders.js";
import { formatRecipient, postcardBackSchema } from "../../shared/postcards.js";
import { refreshFontOrigins, verifyFontUrl } from "../fonts.js";
import {
  adminLoginRateLimit,
  emailRateLimit,
  httpError,
  requireAdmin,
  verifyCsrf,
  writeRateLimit,
} from "../middleware.js";
import { env, hasLob, hasStripe, isProduction, isSqlite, lobMode } from "../env.js";
import { mapUploadError, storeImage, uploadMiddleware } from "../uploads.js";
import { StripeNotConfiguredError, classifyStripeError, getStripeKeyCheck, requireStripe } from "../stripe.js";
import { renderMarkdown } from "../markdown.js";
import { escapeHtml } from "../html.js";
import { sendEmailReportingFailure, sendOrderEmail } from "../email.js";
import { LobError, LobNotConfiguredError, sendTestPostcard } from "../lob.js";
import { cleanUp, sendDuePostcards } from "../fulfilment.js";
import {
  destroySessionsForUser,
  findAdminById,
  updateAdminPassword,
  verifyPasswordFor,
} from "../auth.js";

/**
 * Admin API.
 *
 * Every route below is gated by `requireAdmin` and `verifyCsrf`, applied once
 * to the whole router so a new endpoint cannot be added unprotected by
 * accident. In v1 these operations were completely open.
 */
export const adminRouter: Router = Router();

adminRouter.use(requireAdmin, verifyCsrf, writeRateLimit);

function toHttp(error: unknown): never {
  if (error instanceof SlugTakenError) throw httpError(409, error.message);
  if (error instanceof StripeNotConfiguredError) throw httpError(503, error.message);
  if (error instanceof LobNotConfiguredError) throw httpError(503, error.message);
  const stripeError = classifyStripeError(error);
  if (stripeError) throw httpError(stripeError.status, stripeError.message);
  if (error instanceof ZodError) {
    const first = error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.");
  }
  throw error;
}

/* ------------------------------------------------------------- environment */

/** What is wired up on the server, as booleans. Never a value. */
adminRouter.get("/environment", (_req, res) => {
  res.json({
    hasStripeSecret: hasStripe,
    stripeMode: env.STRIPE_SECRET_KEY
      ? env.STRIPE_SECRET_KEY.startsWith("sk_live_")
        ? "live"
        : "test"
      : null,
    stripeKeyStatus: getStripeKeyCheck().status,
    hasWebhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
    hasEmail: Boolean(env.SMTP_URL),
    hasLob,
    lobMode,
    database: isSqlite ? "sqlite" : "postgres",
    publicUrl: env.PUBLIC_URL,
    production: isProduction,
  } satisfies EnvironmentStatus);
});

/** Send one test email to the signed-in administrator, reporting the transport's own answer. */
adminRouter.post("/email/test", emailRateLimit, async (req, res) => {
  const admin = await findAdminById(req.session.adminId!);
  if (!admin) throw httpError(401, "Sign in again.");

  const settings = await getSettings();
  const storeName = settings?.name ?? "Postcard Gifts";

  const result = await sendEmailReportingFailure(
    admin.email,
    `${storeName}: test email`,
    `<p>This is a test from the ${escapeHtml(storeName)} admin.</p>` +
      "<p>If you are reading it, order confirmations, postcard notices and password resets will reach their recipients too.</p>",
  );

  res.json(result satisfies EmailTestResult);
});

/**
 * Send one test postcard to Lob's own test address.
 *
 * This is the check v1 never had. The whole pipeline runs — a print file at
 * Lob's size and density, the back rendered from the template, the request
 * Lob actually receives — and whatever Lob says comes back verbatim. With a
 * `test_` key nothing is printed; the UI says what a live key would cost.
 */
adminRouter.post("/lob/test", emailRateLimit, async (req, res) => {
  const back = postcardBackSchema.safeParse(req.body ?? {});

  try {
    const card = await sendTestPostcard(
      back.success
        ? back.data
        : postcardBackSchema.parse({ text: "This is a test postcard from the admin.", valediction: "— the printer check" }),
    );

    res.json({
      ok: true,
      message:
        card.mode === "live"
          ? `Lob accepted it as ${card.id}. This was a live key, so a real card is on its way to Lob's office.`
          : `Lob accepted it as ${card.id} in test mode. Nothing was printed.`,
      url: card.url,
    } satisfies LobTestResult);
  } catch (error) {
    if (error instanceof LobNotConfiguredError) {
      res.json({ ok: false, message: error.message, url: null } satisfies LobTestResult);
      return;
    }
    if (error instanceof LobError) {
      // Lob's own words: this is the whole diagnosis, and the reason the
      // button exists.
      res.json({ ok: false, message: error.message, url: null } satisfies LobTestResult);
      return;
    }
    throw error;
  }
});

/** An overview of fulfilment: how many cards are where. */
adminRouter.get("/fulfilment", async (_req, res) => {
  res.json({ postcards: await countPostcardsByStatus(), hasLob, lobMode });
});

/** Run the sweep now rather than waiting for the next tick. */
adminRouter.post("/fulfilment/run", async (_req, res) => {
  const result = await sendDuePostcards();
  res.json(result);
});

adminRouter.post("/fulfilment/cleanup", async (_req, res) => {
  res.json(await cleanUp());
});

/* ------------------------------------------------------------------- pages */

adminRouter.get("/pages", async (_req, res) => {
  res.json(await listPageDrafts());
});

adminRouter.post("/pages", async (req, res) => {
  try {
    const input = pageInputSchema.parse(req.body);
    res.status(201).json({ id: await createPage(input) });
  } catch (error) {
    toHttp(error);
  }
});

/** What a body will look like once it is published, rendered by the same sanitiser the storefront uses. */
adminRouter.post("/pages/preview", (req, res) => {
  const parsed = pagePreviewInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "A Markdown body is required.");

  res.json({ bodyHtml: renderMarkdown(parsed.data.body) });
});

// Registered before `/pages/:id`, so "reorder" and "preview" are never read as page ids.
adminRouter.post("/pages/reorder", async (req, res) => {
  let ids;
  try {
    ({ ids } = reorderInputSchema.parse(req.body));
  } catch (error) {
    toHttp(error);
  }
  await reorderPages(ids);
  res.status(204).end();
});

adminRouter.put("/pages/:id", async (req, res) => {
  if (!(await pageExists(req.params.id))) throw httpError(404, "Page not found.");

  try {
    const input = pageInputSchema.parse(req.body);
    await updatePage(req.params.id, input);
    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

adminRouter.delete("/pages/:id", async (req, res) => {
  if (!(await pageExists(req.params.id))) throw httpError(404, "Page not found.");

  await deletePage(req.params.id);
  res.status(204).end();
});

/* ---------------------------------------------------------------- settings */

adminRouter.get("/settings", async (_req, res) => {
  const settings = await getSettings();
  if (!settings) throw httpError(404, "Settings have not been created yet.");
  res.json(settings);
});

adminRouter.put("/settings", async (req, res) => {
  try {
    const input = settingsInputSchema.parse(req.body);

    // Before the write: a font URL that cannot be fetched is a typo, and the
    // merchant has to be told while the field is still in front of them.
    await verifyFontUrl(input.theme.fontUrl);

    await updateSettings(input);

    // The CSP has to widen — or narrow — with the value that was just saved.
    await refreshFontOrigins();

    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

/** Stores a logo and hands the image back; it is persisted on Save with the rest of the theme. */
adminRouter.post("/settings/logo", (req, res, next) => {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(mapUploadError(uploadError));
        if (!req.file) throw httpError(400, "No file was uploaded.");

        const { alt } = imageInputSchema.parse(req.body ?? {});
        const stored = await storeImage("store-logo", req.file.buffer);

        res.status(201).json({ ...stored, alt });
      } catch (error) {
        next(error);
      }
    })();
  });
});

adminRouter.post("/settings/hero-image", (req, res, next) => {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(mapUploadError(uploadError));
        if (!req.file) throw httpError(400, "No file was uploaded.");

        const { alt } = imageInputSchema.parse(req.body ?? {});
        const stored = await storeImage("store-hero", req.file.buffer);

        res.status(201).json({ ...stored, alt });
      } catch (error) {
        next(error);
      }
    })();
  });
});

/* ------------------------------------------------------------------ orders */

adminRouter.get("/orders", async (req, res) => {
  const status = orderStatusSchema.safeParse(req.query.status);

  res.json(
    await listOrders({
      ...(status.success ? { status: status.data } : {}),
      limit: Number(req.query.limit ?? 25),
      offset: Number(req.query.offset ?? 0),
    }),
  );
});

const CSV_COLUMNS = [
  "order_reference",
  "order_id",
  "placed_at",
  "order_status",
  "email",
  "recipient_name",
  "recipient_address",
  "mail_date",
  "postcard_status",
  "lob_id",
  "expected_delivery",
  "last_error",
  "unit_price_cents",
  "order_postcards",
  "order_subtotal_cents",
  "order_discount_cents",
  "order_total_cents",
  "order_refunded_cents",
  "currency",
] as const;

const CSV_ROW_CAP = 50_000;

/**
 * Orders as CSV, one row per postcard, so the file pivots usefully.
 *
 * Registered before `/orders/:id` on purpose: Express matches in order, and
 * "orders.csv" would otherwise arrive as an order id. Every money column is
 * named `*_cents` and holds an integer.
 */
adminRouter.get("/orders.csv", async (req, res) => {
  const status = orderStatusSchema.safeParse(req.query.status);
  const from = Number(req.query.from);
  const to = Number(req.query.to);

  const filters = {
    ...(status.success ? { status: status.data } : {}),
    ...(Number.isFinite(from) ? { from } : {}),
    ...(Number.isFinite(to) ? { to } : {}),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="orders-${stamp}.csv"`);

  res.write(CSV_BOM);
  res.write(csvRow(CSV_COLUMNS));

  let offset = 0;
  let written = 0;
  let truncated = false;

  for (;;) {
    const page = await listOrders({ ...filters, limit: 100, offset });
    if (page.orders.length === 0) break;

    for (const order of page.orders) {
      const placedAt = new Date(order.createdAt).toISOString();
      const orderFields = [
        order.unitPriceCents,
        order.postcardCount,
        order.subtotalCents,
        order.discountCents,
        order.totalCents,
        order.refundedCents,
        order.currency,
      ];

      const postcards = order.postcards.length > 0 ? order.postcards : [null];

      for (const postcard of postcards) {
        if (written >= CSV_ROW_CAP) {
          truncated = true;
          break;
        }

        res.write(
          csvRow([
            order.reference,
            order.id,
            placedAt,
            order.status,
            order.email,
            postcard?.recipient.name ?? "",
            postcard ? formatRecipient(postcard.recipient) : "",
            postcard?.mailDate ?? "",
            postcard?.status ?? "",
            postcard?.lobId ?? "",
            postcard?.expectedDeliveryDate ?? "",
            postcard?.lastError ?? "",
            ...orderFields,
          ]),
        );
        written += 1;
      }

      if (truncated) break;
    }

    if (truncated) break;
    offset += page.orders.length;
    if (offset >= page.total) break;
  }

  if (truncated) {
    console.warn(`Order CSV export stopped at the ${CSV_ROW_CAP} row cap. Narrow it with ?from= and ?to=.`);
  }

  res.end();
});

adminRouter.get("/orders/:id", async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw httpError(404, "Order not found.");
  res.json(order);
});

/**
 * Cancel an order. Whatever has not gone to print is withdrawn; cards Lob
 * already has are left alone — the mail has gone. Money is not touched: a
 * refund is its own decision, below.
 */
adminRouter.post("/orders/:id/cancel", async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw httpError(404, "Order not found.");
  if (order.status === "cancelled" || order.status === "refunded") {
    throw httpError(409, `This order is already ${order.status}.`);
  }

  const withdrawn = await cancelOrder(order.id);
  const updated = await getOrder(order.id);
  res.json({ order: updated, withdrawn });
});

/** Put an errored card back on the schedule. The next sweep tries it again. */
adminRouter.post("/orders/:id/postcards/:postcardId/retry", async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw httpError(404, "Order not found.");
  if (order.status !== "paid" && order.status !== "completed") {
    throw httpError(409, "Only a paid order's postcards can be retried.");
  }

  const postcard = await getPostcard(order.id, req.params.postcardId);
  if (!postcard) throw httpError(404, "Postcard not found on that order.");

  if (!(await requeuePostcard(order.id, postcard.id))) {
    throw httpError(409, "Only a postcard that failed or was cancelled can be retried.");
  }

  // A completed order that gets a card back is open again.
  if (order.status === "completed") {
    const { setOrderStatus } = await import("../../db/orders-repository.js");
    await setOrderStatus(order.id, "paid");
  }

  const updated = await getOrder(order.id);
  res.json({ order: updated });
});

/** Withdraw one card that has not gone out. */
adminRouter.post("/orders/:id/postcards/:postcardId/cancel", async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw httpError(404, "Order not found.");

  const postcard = await getPostcard(order.id, req.params.postcardId);
  if (!postcard) throw httpError(404, "Postcard not found on that order.");

  if (!(await cancelPostcard(order.id, postcard.id))) {
    throw httpError(409, "That postcard has already gone to print, or was already cancelled.");
  }

  await completeOrderIfDone(order.id);
  const updated = await getOrder(order.id);
  res.json({ order: updated });
});

/**
 * Refund an order, in whole or in part.
 *
 * Money moves here; order state does not. The `charge.refunded` webhook is
 * the only thing that writes `refundedCents` or flips the status.
 */
adminRouter.post("/orders/:id/refund", async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw httpError(404, "Order not found.");

  let input;
  try {
    input = refundInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  const paymentIntentId = await getOrderPaymentIntentId(order.id);
  if (!paymentIntentId) {
    throw httpError(409, "This order has no payment to refund. It was never paid, or payment is still pending.");
  }

  const remaining = order.totalCents - order.refundedCents;
  if (remaining <= 0) throw httpError(409, "This order has already been refunded in full.");

  const amountCents = input.amountCents ?? remaining;
  if (amountCents <= 0) throw httpError(400, "A refund has to be for more than zero.");
  if (amountCents > remaining) {
    const locale = (await getSettings())?.locale ?? "en-US";
    throw httpError(
      409,
      `That is more than the ${formatMoney(remaining, order.currency, locale)} still refundable on this order.`,
    );
  }

  const stripe = requireStripe();

  try {
    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        reason: input.reason,
        metadata: { postcards_order_id: order.id },
      },
      { idempotencyKey: `refund-${order.id}-${input.amountCents ?? "full"}` },
    );
  } catch (error) {
    toHttp(error);
  }

  const updated = await getOrder(order.id);
  if (!updated) throw httpError(404, "Order not found.");

  let emailed = false;
  if (input.notify) emailed = await sendOrderEmail("Refunded", updated);

  res.json({ order: updated, emailed });
});

/* ----------------------------------------------------------------- account */

/** Change your own password. Rate-limited with the login limiter: this verifies a password. */
adminRouter.put("/users/me/password", adminLoginRateLimit, async (req, res) => {
  let input;
  try {
    input = passwordChangeInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  const id = req.session.adminId!;
  if (!(await verifyPasswordFor(id, input.current))) {
    throw httpError(401, "That is not your current password.");
  }

  await updateAdminPassword(id, input.next);

  // Every other session this account holds is signed out; only the one that
  // just proved it knows the old password survives.
  await destroySessionsForUser(id, { except: req.sessionID });

  res.status(204).end();
});
