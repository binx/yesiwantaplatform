import { Router } from "express";
import { ZodError } from "zod";
import {
  collectionInputSchema,
  imageAltInputSchema,
  imageInputSchema,
  imagePathInputSchema,
  imageReorderInputSchema,
  productInputSchema,
  reorderInputSchema,
  settingsInputSchema,
  shippingTableInputSchema,
  type EnvironmentStatus,
} from "../../shared/api.js";
import {
  SlugTakenError,
  addProductImage,
  collectionExists,
  createCollection,
  createProduct,
  deleteCollection,
  deleteProduct,
  getStripeProductId,
  listAllProductsForAdmin,
  productExists,
  removeProductImage,
  reorderCollections,
  reorderProductImages,
  reorderProducts,
  updateCollection,
  updateProduct,
  updateProductImageAlt,
  updateSettings,
} from "../../db/admin-repository.js";
import { findProductBySlug, getSettings, listCollections, listProducts } from "../../db/repository.js";
import { formatMoney } from "../../shared/money.js";
import {
  getOrder,
  getOrderPaymentIntentId,
  listOrders,
  updateFulfilment,
} from "../../db/orders-repository.js";
import { getShippingTable, replaceShippingTable } from "../../db/shipping-repository.js";
import { fulfilmentInputSchema, orderStatusSchema, refundInputSchema } from "../../shared/orders.js";
import { httpError, requireAdmin, verifyCsrf, writeRateLimit } from "../middleware.js";
import { env, hasStripe, isSqlite } from "../env.js";
import { deleteImageFile, storeImage, uploadMiddleware } from "../uploads.js";
import { archiveProductInStripe, syncProductToStripe } from "../catalog-sync.js";
import { StripeNotConfiguredError, requireStripe } from "../stripe.js";
import { sendOrderEmail, templateForStatus } from "../email.js";

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
  if (error instanceof ZodError) {
    const first = error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.");
  }
  throw error;
}

/* ------------------------------------------------------------- environment */

/**
 * What is wired up on the server, as booleans.
 *
 * The admin dashboard needs to say "Stripe is not connected" without the
 * secret key ever being readable over HTTP — so this reports presence and
 * mode, never a value. v1 served its whole `config.env` to the client.
 */
adminRouter.get("/environment", (_req, res) => {
  res.json({
    hasStripeSecret: hasStripe,
    stripeMode: env.STRIPE_SECRET_KEY
      ? env.STRIPE_SECRET_KEY.startsWith("sk_live_")
        ? "live"
        : "test"
      : null,
    hasWebhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
    hasEmail: Boolean(env.SMTP_URL),
    database: isSqlite ? "sqlite" : "postgres",
    publicUrl: env.PUBLIC_URL,
  } satisfies EnvironmentStatus);
});

/* ---------------------------------------------------------------- products */

adminRouter.get("/products", async (_req, res) => {
  res.json(await listAllProductsForAdmin());
});

/** Drafts included, unlike the public listing. */
adminRouter.get("/products/full", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  const offset = Number(req.query.offset ?? 0);
  res.json(await listProducts({ liveOnly: false, limit, offset }));
});

adminRouter.get("/products/:slug", async (req, res) => {
  const product = await findProductBySlug(req.params.slug, false);
  if (!product) throw httpError(404, "Product not found.");
  res.json(product);
});

adminRouter.post("/products", async (req, res) => {
  try {
    const input = productInputSchema.parse(req.body);
    res.status(201).json({ id: await createProduct(input) });
  } catch (error) {
    toHttp(error);
  }
});

adminRouter.put("/products/:id", async (req, res) => {
  if (!(await productExists(req.params.id))) throw httpError(404, "Product not found.");

  try {
    const input = productInputSchema.parse(req.body);
    await updateProduct(req.params.id, input);
    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

adminRouter.delete("/products/:id", async (req, res) => {
  if (!(await productExists(req.params.id))) throw httpError(404, "Product not found.");

  const stripeProductId = await getStripeProductId(req.params.id);

  const paths = await deleteProduct(req.params.id);
  // Best-effort file cleanup; the database is already consistent.
  await Promise.all(paths.map((p) => deleteImageFile(p).catch(() => undefined)));

  // Archived, never deleted: a past order still references its Prices, and
  // Stripe will not delete a Product that has any.
  if (stripeProductId && hasStripe) {
    await archiveProductInStripe(stripeProductId).catch(() => undefined);
  }

  res.status(204).end();
});

adminRouter.post("/products/reorder", async (req, res) => {
  const { ids } = reorderInputSchema.parse(req.body);
  await reorderProducts(ids);
  res.status(204).end();
});

/* ------------------------------------------------------------------ images */

adminRouter.post("/products/:id/images", (req, res, next) => {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(uploadError);
        if (!req.file) throw httpError(400, "No file was uploaded.");
        if (!(await productExists(req.params.id))) throw httpError(404, "Product not found.");

        const { alt } = imageInputSchema.parse(req.body ?? {});
        const stored = await storeImage(req.params.id, req.file.buffer);

        await addProductImage(req.params.id, { ...stored, alt });
        res.status(201).json(stored);
      } catch (error) {
        next(error);
      }
    })();
  });
});

adminRouter.delete("/products/:id/images", async (req, res) => {
  const parsed = imagePathInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "An image path is required.");

  const removed = await removeProductImage(req.params.id, parsed.data.path);
  if (!removed) throw httpError(404, "Image not found on that product.");

  await deleteImageFile(removed);
  res.status(204).end();
});

adminRouter.put("/products/:id/images", async (req, res) => {
  const parsed = imageAltInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "An image path and alt text are required.");

  const updated = await updateProductImageAlt(req.params.id, parsed.data.path, parsed.data.alt);
  if (!updated) throw httpError(404, "Image not found on that product.");

  res.status(204).end();
});

adminRouter.post("/products/:id/images/reorder", async (req, res) => {
  const parsed = imageReorderInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "A list of image paths is required.");

  await reorderProductImages(req.params.id, parsed.data.paths);
  res.status(204).end();
});

/* ------------------------------------------------------------- collections */

adminRouter.get("/collections", async (_req, res) => {
  res.json(await listCollections());
});

adminRouter.post("/collections", async (req, res) => {
  try {
    const input = collectionInputSchema.parse(req.body);
    res.status(201).json({ id: await createCollection(input) });
  } catch (error) {
    toHttp(error);
  }
});

adminRouter.put("/collections/:id", async (req, res) => {
  if (!(await collectionExists(req.params.id))) throw httpError(404, "Collection not found.");

  try {
    const input = collectionInputSchema.parse(req.body);
    await updateCollection(req.params.id, input);
    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

adminRouter.delete("/collections/:id", async (req, res) => {
  // Checked rather than assumed: v1's delete ran an unguarded splice on a
  // findIndex result, so a miss removed the last collection instead.
  if (!(await collectionExists(req.params.id))) throw httpError(404, "Collection not found.");

  await deleteCollection(req.params.id);
  res.status(204).end();
});

adminRouter.post("/collections/reorder", async (req, res) => {
  const { ids } = reorderInputSchema.parse(req.body);
  await reorderCollections(ids);
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
    await updateSettings(input);
    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

/* ---------------------------------------------------------------- shipping */

adminRouter.get("/shipping", async (_req, res) => {
  res.json(await getShippingTable());
});

/**
 * Replace the whole shipping table.
 *
 * One save rather than per-row CRUD: a rate can reference a zone created in
 * the same edit, and a zone can be removed out from under a rate, so the two
 * only make sense written together.
 */
adminRouter.put("/shipping", async (req, res) => {
  try {
    const input = shippingTableInputSchema.parse(req.body);

    // A rate may only point at a zone present in the same payload; anything
    // else would leave a dangling reference the moment it is written.
    const zoneKeys = new Set(input.zones.map((zone) => zone.id).filter(Boolean));
    for (const rate of input.rates) {
      if (rate.zoneId !== null && !zoneKeys.has(rate.zoneId)) {
        throw httpError(400, `"${rate.name}" refers to a zone that is not in this save.`);
      }
    }

    await replaceShippingTable(input);
    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

/* ------------------------------------------------------------------ Stripe */

/**
 * Publish a product to Stripe.
 *
 * Deliberately explicit rather than automatic on save. v1's wizard wrote to
 * Stripe on every step, so abandoning it left orphaned Products behind; here
 * nothing reaches a live Stripe account until this is called.
 */
adminRouter.post("/products/:id/publish", async (req, res) => {
  const product = await listProducts({ liveOnly: false, limit: 200 }).then((page) =>
    page.products.find((p) => p.id === req.params.id),
  );
  if (!product) throw httpError(404, "Product not found.");

  try {
    res.json(await syncProductToStripe(product));
  } catch (error) {
    toHttp(error);
  }
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

adminRouter.get("/orders/:id", async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw httpError(404, "Order not found.");
  res.json(order);
});

adminRouter.put("/orders/:id", async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw httpError(404, "Order not found.");

  let input;
  try {
    input = fulfilmentInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  await updateFulfilment(order.id, {
    status: input.status,
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
  });

  const updated = await getOrder(order.id);
  if (!updated) throw httpError(404, "Order not found.");

  // Emailing is opt-in per change, so correcting a typo does not spam a buyer.
  let emailed = false;
  if (input.notify) {
    const template = templateForStatus(input.status);
    if (template) emailed = await sendOrderEmail(template, updated);
  }

  res.json({ order: updated, emailed });
});

/**
 * Refund an order, in whole or in part.
 *
 * Money moves here; order state does not. The `charge.refunded` webhook is
 * still the only thing that writes `refundedCents` or flips the status, for
 * the same reason `checkout.session.completed` is the only thing that marks an
 * order paid: a 200 from Stripe's API is not the same as a settled refund, and
 * the webhook path is already idempotent. The client polls for the change.
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
    throw httpError(
      409,
      "This order has no payment to refund. It was never paid, or payment is still pending.",
    );
  }

  const remaining = order.totalCents - order.refundedCents;
  if (remaining <= 0) {
    throw httpError(409, "This order has already been refunded in full.");
  }

  const amountCents = input.amountCents ?? remaining;
  if (amountCents <= 0) {
    throw httpError(400, "A refund has to be for more than zero.");
  }
  if (amountCents > remaining) {
    throw httpError(
      409,
      `That is more than the ${formatMoney(remaining, order.currency)} still refundable on this order.`,
    );
  }

  const stripe = requireStripe();

  try {
    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        reason: input.reason,
        // Copied onto the resulting charge update so the webhook can find the
        // order without a lookup by payment intent.
        metadata: { beluga_order_id: order.id },
      },
      // Keyed on the amount as well as the order: a merchant refunding the same
      // partial amount twice by mistake gets one refund, but two deliberate
      // partials of different sizes both go through.
      { idempotencyKey: `refund-${order.id}-${input.amountCents ?? "full"}` },
    );
  } catch (error) {
    toHttp(error);
  }

  // Deliberately re-read rather than patched: the webhook owns the new figures,
  // and returning a guess would have the UI flicker back when it lands.
  const updated = await getOrder(order.id);
  if (!updated) throw httpError(404, "Order not found.");

  let emailed = false;
  if (input.notify) {
    emailed = await sendOrderEmail("Refunded", updated);
  }

  res.json({ order: updated, emailed });
});
