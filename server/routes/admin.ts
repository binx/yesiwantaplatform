import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { ZodError } from "zod";
import {
  collectionInputSchema,
  imageAltInputSchema,
  imageInputSchema,
  imagePathInputSchema,
  imageReorderInputSchema,
  pageInputSchema,
  pagePreviewInputSchema,
  productInputSchema,
  reorderInputSchema,
  inviteInputSchema,
  passwordChangeInputSchema,
  settingsInputSchema,
  shippingTableInputSchema,
  storefrontAccessInputSchema,
  storefrontPasswordInputSchema,
  type EmailTestResult,
  type EnvironmentStatus,
  type StorefrontStatus,
} from "../../shared/api.js";
import { webhookEndpointInputSchema } from "../../shared/webhooks.js";
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
  listCollectionDrafts,
  productExists,
  removeProductImage,
  reorderCollections,
  reorderProductImages,
  reorderProducts,
  updateCollection,
  updateProduct,
  updateProductImageAlt,
  updateSettings,
  clearStorefrontPassword,
  clearStorefrontShareToken,
  setStorefrontAccess,
  setStorefrontPassword,
  setStorefrontShareToken,
} from "../../db/admin-repository.js";
import {
  findProductBySlug,
  findProductsBySlugs,
  getSettings,
  getStorefrontState,
  listProducts,
} from "../../db/repository.js";
import {
  createPage,
  deletePage,
  listPageDrafts,
  pageExists,
  reorderPages,
  updatePage,
} from "../../db/pages-repository.js";
import { formatMoney } from "../../shared/money.js";
import { refreshFontOrigins, verifyFontUrl } from "../fonts.js";
import {
  CSV_BOM,
  CsvStreamParser,
  csvRow,
  unguardCsvField,
  type CsvRecord,
} from "../../shared/csv.js";
import {
  CATALOGUE_CSV_COLUMNS,
  CsvFormatError,
  buildImportPlan,
  productCsvRows,
  readCsvHeader,
  type ImportPlan,
} from "../../shared/catalogue-csv.js";
import {
  getOrder,
  getOrderPaymentIntentId,
  listOrders,
  restockInventoryForOrder,
  updateFulfilment,
} from "../../db/orders-repository.js";
import { getShippingTable, replaceShippingTable } from "../../db/shipping-repository.js";
import {
  createEndpoint,
  deleteEndpoint,
  findDelivery,
  findEndpoint,
  listDeliveries,
  listEndpoints,
  resetDelivery,
  rotateEndpointSecret,
  toDeliverySummary,
  toEndpointSummary,
  updateEndpoint,
} from "../../db/webhooks-repository.js";
import { fulfilmentInputSchema, orderStatusSchema, refundInputSchema } from "../../shared/orders.js";
import {
  findDuplicateCombination,
  optionSelectionsAreWellFormed,
} from "../../shared/product-options.js";
import {
  emailRateLimit,
  httpError,
  requireAdmin,
  verifyCsrf,
  writeRateLimit,
} from "../middleware.js";
import { env, hasStripe, isProduction, isSqlite } from "../env.js";
import { deleteImageFile, storeImage, uploadMiddleware } from "../uploads.js";
import { archiveProductInStripe, syncProductToStripe } from "../catalog-sync.js";
import { StripeNotConfiguredError, requireStripe } from "../stripe.js";
import { renderMarkdown } from "../markdown.js";
import { escapeHtml } from "../html.js";
import {
  EndpointNotAllowedError,
  assertDeliverableUrl,
  emitOrderEvent,
  emitProductPublished,
  generateSigningSecret,
} from "../webhooks.js";
import {
  sendEmail,
  sendEmailReportingFailure,
  sendOrderEmail,
  templateForStatus,
} from "../email.js";
import {
  EmailTakenError,
  countOwners,
  createInvite,
  deleteAdmin,
  emailIsTaken,
  destroySessionsForUser,
  findAdminById,
  hashPassword,
  hashToken,
  listAdmins,
  listPendingInvites,
  revokeInvite,
  updateAdminPassword,
  verifyPasswordFor,
} from "../auth.js";
import { loginRateLimit } from "../middleware.js";

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
  if (error instanceof EmailTakenError) throw httpError(409, error.message);
  if (error instanceof StripeNotConfiguredError) throw httpError(503, error.message);
  if (error instanceof EndpointNotAllowedError) throw httpError(422, error.message);
  // The file's shape is wrong rather than its contents, so there is no row to
  // point at — the message says what the header must look like instead.
  if (error instanceof CsvFormatError) throw httpError(400, error.message);
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
    production: isProduction,
  } satisfies EnvironmentStatus);
});

/**
 * Send one test email to the signed-in administrator.
 *
 * `SMTP_URL` being set is not the same as email working, and every other send
 * in this codebase swallows its failure by design, so a wrong port or a sender
 * the provider will not accept stays invisible until a customer does not get a
 * confirmation. This is the one path that reports the transport's own answer.
 *
 * The recipient is the session's administrator and nothing else. Taking a `to`
 * from the body would turn an admin session into a way to send mail to
 * strangers over the merchant's own SMTP reputation — which is what
 * `emailRateLimit` exists to bound elsewhere, and it applies here too, because
 * this is a send.
 */
adminRouter.post("/email/test", emailRateLimit, async (req, res) => {
  const admin = await findAdminById(req.session.adminId!);
  if (!admin) throw httpError(401, "Sign in again.");

  const settings = await getSettings();
  const storeName = settings?.name ?? "Beluga";

  const result = await sendEmailReportingFailure(
    admin.email,
    `${storeName}: test email`,
    `<p>This is a test from the ${escapeHtml(storeName)} admin.</p>` +
      "<p>If you are reading it, order confirmations, password resets and staff " +
      "invitations will reach their recipients too.</p>",
  );

  res.json(result satisfies EmailTestResult);
});

/**
 * Checks the schema cannot express on its own: every variant must name a real
 * combination of the product's own option values, and no two variants may
 * name the same one.
 */
function assertValidOptions(input: { options: { name: string; values: string[] }[]; variants: { optionValues: string[] }[] }): void {
  if (!optionSelectionsAreWellFormed(input.options, input.variants)) {
    throw httpError(
      400,
      "Every price must choose exactly one value for each option, from that option's own list.",
    );
  }

  const duplicate = findDuplicateCombination(input.variants);
  if (duplicate) {
    throw httpError(
      409,
      duplicate.length > 0
        ? `Two prices are both “${duplicate.join(" / ")}.” Combinations must be unique.`
        : "A product with no options can only have one price.",
    );
  }
}

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

/* ------------------------------------------------------- catalogue as CSV */

/**
 * A merchant with a catalogue larger than this is past what a spreadsheet
 * round trip is the right tool for, and an unbounded read would let one
 * request stream for hours.
 */
const CATALOGUE_CSV_ROW_CAP = 50_000;

/**
 * The whole catalogue, one row per variant with product fields repeated.
 *
 * Drafts included: the file is a working copy of the catalogue, and a merchant
 * migrating from Shopify is editing drafts more often than live products.
 * Streamed a page at a time rather than assembled in memory, like
 * `/orders.csv` above and for the same reason.
 */
adminRouter.get("/products.csv", async (_req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="catalogue-${stamp}.csv"`);

  // The BOM has to be the first bytes on the wire, before the header row.
  res.write(CSV_BOM);
  res.write(csvRow(CATALOGUE_CSV_COLUMNS));

  let offset = 0;
  let written = 0;

  for (;;) {
    const page = await listProducts({ liveOnly: false, limit: 200, offset });
    if (page.products.length === 0) break;

    for (const product of page.products) {
      for (const row of productCsvRows(product)) {
        if (written >= CATALOGUE_CSV_ROW_CAP) break;
        res.write(csvRow(row));
        written += 1;
      }
    }

    offset += page.products.length;
    if (offset >= page.total || written >= CATALOGUE_CSV_ROW_CAP) break;
  }

  if (written >= CATALOGUE_CSV_ROW_CAP) {
    console.warn(`Catalogue CSV export stopped at the ${CATALOGUE_CSV_ROW_CAP} row cap.`);
  }

  res.end();
});

/** Enough for a large migration, bounded so one request cannot exhaust memory. */
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const IMPORT_MAX_ROWS = 5_000;

/**
 * More than this in one response is unreadable in the preview table and large
 * enough to be worth not serialising. The count of what was left out is
 * reported instead.
 */
const IMPORT_MAX_REPORTED_ERRORS = 200;

/**
 * Read the uploaded file and work out what it would do.
 *
 * The body is the CSV itself as `text/csv`, so it arrives as an untouched
 * stream — `express.json` ignores it — and is fed to the parser chunk by chunk.
 * Nothing is buffered whole: the byte cap stops an oversized upload while it is
 * still arriving rather than after it has been held in memory, and the row cap
 * stops reading a file with more rows than this will ever write.
 */
async function planCatalogueImport(req: Request): Promise<ImportPlan> {
  const parser = new CsvStreamParser();
  const records: CsvRecord[] = [];
  let header: Map<string, number> | null = null;
  let bytes = 0;

  const take = (batch: CsvRecord[]) => {
    for (const record of batch) {
      // The first record is the header, whatever it says.
      if (!header) {
        header = readCsvHeader(record.fields);
        continue;
      }

      if (records.length >= IMPORT_MAX_ROWS) {
        throw httpError(
          413,
          `This file has more than ${IMPORT_MAX_ROWS} rows. Split it and import the parts one at a time.`,
        );
      }

      records.push(record);
    }
  };

  req.setEncoding("utf8");

  for await (const chunk of req as AsyncIterable<string>) {
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > IMPORT_MAX_BYTES) {
      throw httpError(
        413,
        `This file is larger than ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} MB. Split it and import the parts one at a time.`,
      );
    }

    take(parser.push(chunk));
  }

  take(parser.end());

  if (!header) throw httpError(400, "That file is empty. The first row must name the columns.");

  const slugs = [...new Set(records.map((record) => record.fields[header!.get("slug") ?? -1] ?? ""))]
    .map((slug) => unguardCsvField(slug).trim())
    .filter((slug) => slug !== "");

  const existing = await findProductsBySlugs(slugs);

  return buildImportPlan({
    records,
    header,
    existing: new Map(existing.map((product) => [product.slug, product])),
  });
}

/** The plan as the preview screen receives it: counts, errors, and a summary row per product. */
function summariseImport(plan: ImportPlan) {
  return {
    rows: plan.rows,
    creates: plan.creates,
    updates: plan.updates,
    errors: plan.errors.slice(0, IMPORT_MAX_REPORTED_ERRORS),
    errorsOmitted: Math.max(plan.errors.length - IMPORT_MAX_REPORTED_ERRORS, 0),
    products: plan.entries.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      action: entry.action,
      variants: entry.variants,
      rows: entry.rows,
      /** False when this product has errors and would be skipped. */
      valid: Boolean(entry.input),
    })),
  };
}

/**
 * Phase one: say what the file would do, and change nothing.
 *
 * Separate from the commit because a partial import that half-updated a live
 * catalogue is worse than no import at all. The merchant sees every error at
 * once — a 500-row file corrected one error per attempt is a file that never
 * gets imported.
 */
adminRouter.post("/products/import/validate", async (req, res) => {
  try {
    res.json(summariseImport(await planCatalogueImport(req)));
  } catch (error) {
    toHttp(error);
  }
});

/**
 * Phase two: apply it.
 *
 * The file is parsed and validated again rather than carried over from the
 * preview in a session. Re-reading is cheap, and it means nothing can be
 * committed that has not just been validated by the same code — including a
 * file edited between the two requests.
 *
 * **Nothing here writes to Stripe.** Invariant 7: products reach Stripe only
 * through the explicit per-product publish below. An imported product lands as
 * a draft unless `is_live` says otherwise, and even a live one is not
 * published until someone asks.
 */
adminRouter.post("/products/import/commit", async (req, res) => {
  const skipInvalid = req.query.skipInvalid === "true";

  try {
    const plan = await planCatalogueImport(req);

    if (plan.errors.length > 0 && !skipInvalid) {
      throw httpError(
        400,
        `${plan.errors.length} row${plan.errors.length === 1 ? " has" : "s have"} a problem, so nothing was imported. Fix the file, or choose to skip the invalid rows.`,
      );
    }

    let created = 0;
    let updated = 0;

    for (const entry of plan.entries) {
      // Absent means the product had errors; reaching here means the merchant
      // asked for the rest to go in anyway.
      if (!entry.input) continue;

      if (entry.productId) {
        await updateProduct(entry.productId, entry.input);
        updated += 1;
      } else {
        await createProduct(entry.input);
        created += 1;
      }
    }

    res.json({ created, updated, skipped: plan.entries.length - created - updated });
  } catch (error) {
    toHttp(error);
  }
});

adminRouter.get("/products/:slug", async (req, res) => {
  const product = await findProductBySlug(req.params.slug, false);
  if (!product) throw httpError(404, "Product not found.");
  res.json(product);
});

adminRouter.post("/products", async (req, res) => {
  try {
    const input = productInputSchema.parse(req.body);
    assertValidOptions(input);
    res.status(201).json({ id: await createProduct(input) });
  } catch (error) {
    toHttp(error);
  }
});

adminRouter.put("/products/:id", async (req, res) => {
  if (!(await productExists(req.params.id))) throw httpError(404, "Product not found.");

  try {
    const input = productInputSchema.parse(req.body);
    assertValidOptions(input);
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
  // Drafts, not the storefront shape: the editor round-trips the Markdown a
  // merchant typed, and `listCollections` has already rendered it away.
  res.json(await listCollectionDrafts());
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

/**
 * A collection's cover image.
 *
 * Stores the file and hands it back; the caller then sends it with the
 * collection in the usual `PUT /collections/:id`, so nothing points at an
 * image that failed to upload. Same division of labour as the theme logo.
 */
adminRouter.post("/collections/:id/cover", (req, res, next) => {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(uploadError);
        if (!req.file) throw httpError(400, "No file was uploaded.");
        if (!(await collectionExists(req.params.id))) throw httpError(404, "Collection not found.");

        const { alt } = imageInputSchema.parse(req.body ?? {});
        const stored = await storeImage(req.params.id, req.file.buffer);

        res.status(201).json({ ...stored, alt });
      } catch (error) {
        next(error);
      }
    })();
  });
});

adminRouter.post("/collections/reorder", async (req, res) => {
  const { ids } = reorderInputSchema.parse(req.body);
  await reorderCollections(ids);
  res.status(204).end();
});

/* ------------------------------------------------------------------- pages */

/**
 * Store pages — a returns policy, shipping information, contact terms.
 *
 * Drafts are included here and nowhere else. Bodies travel as Markdown in both
 * directions; the storefront gets HTML, rendered and sanitised on the way out
 * by `server/markdown.ts`, and nothing is ever stored as HTML.
 */
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

/**
 * What a body will look like once it is published.
 *
 * The editor cannot render its own preview: the Markdown parser and the
 * sanitiser are deliberately server-side, so that neither reaches a shopper's
 * bundle. Rendering the preview through the same function the storefront uses
 * is also the only way a preview is worth trusting — a second implementation
 * would eventually disagree with the first about what is safe.
 */
adminRouter.post("/pages/preview", (req, res) => {
  const parsed = pagePreviewInputSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "A Markdown body is required.");

  res.json({ bodyHtml: renderMarkdown(parsed.data.body) });
});

/*
 * Registered before `/pages/:id`, so "reorder" and "preview" are never read as
 * page ids — the same ordering trap as `/orders.csv` above.
 */
adminRouter.post("/pages/reorder", async (req, res) => {
  const { ids } = reorderInputSchema.parse(req.body);
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

    /*
     * Before the write, not after: a font URL that cannot be fetched is a
     * typo, and the merchant has to be told while the field is still in front
     * of them. Saving first would leave the store pointing at a stylesheet
     * that never arrives, with a fallback face and nothing on screen to say
     * why. See server/fonts.ts.
     */
    await verifyFontUrl(input.theme.fontUrl);

    await updateSettings(input);

    // The CSP has to widen — or narrow — with the value that was just saved,
    // or the browser refuses the very stylesheet this store now asks for.
    await refreshFontOrigins();

    res.status(204).end();
  } catch (error) {
    toHttp(error);
  }
});

/**
 * Stores a logo and hands the image back; it is not persisted here.
 *
 * The theme editor drops the result into the settings form it is already
 * editing, so a logo lands the same way every other look change does — on Save,
 * with the same chance to back out.
 */
adminRouter.post("/settings/logo", (req, res, next) => {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(uploadError);
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

/**
 * Stores a hero image and hands it back; it is not persisted here.
 *
 * The same contract as the logo above, and a separate route for the same
 * reason `store-logo` is a distinct prefix: the stored file is named for what
 * it is, so an operator looking at the assets directory can tell a banner
 * wordmark from a full-bleed landing image without opening either.
 */
adminRouter.post("/settings/hero-image", (req, res, next) => {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(uploadError);
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

/* -------------------------------------------------------- storefront access */

/**
 * Who may view the storefront — see docs/tasks/27-storefront-preview-mode.md.
 *
 * Dedicated routes rather than fields on `settingsInputSchema`: that schema is
 * a full-object PUT with a `.default()` on nearly every field, so a secret
 * living there would be cleared by any client that omitted it.
 */
adminRouter.get("/storefront", async (_req, res) => {
  const state = await getStorefrontState();

  res.json({
    access: state?.access ?? "public",
    hasPassword: Boolean(state?.passwordHash),
    hasShareLink: Boolean(state?.shareTokenHash),
    // Approximate — see the note on the schema. Only meaningful while a link
    // actually exists.
    shareLinkCreatedAt: state?.shareTokenHash ? state.updatedAt : null,
  } satisfies StorefrontStatus);
});

/** The access mode alone. The password has its own routes below. */
adminRouter.put("/storefront", async (req, res) => {
  let input;
  try {
    input = storefrontAccessInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  if (input.access === "password") {
    const state = await getStorefrontState();
    if (!state?.passwordHash) {
      throw httpError(409, "Set a password before requiring one.");
    }
  }

  await setStorefrontAccess(input.access);
  res.status(204).end();
});

/** Set or change the password. Ends every existing viewer session. */
adminRouter.put("/storefront/password", async (req, res) => {
  let input;
  try {
    input = storefrontPasswordInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  await setStorefrontPassword(await hashPassword(input.password));
  res.status(204).end();
});

/**
 * Clear the password. Falls back to public access — access: "password" with
 * no password set is not a lockout, but it is a state that means nothing.
 */
adminRouter.delete("/storefront/password", async (_req, res) => {
  await clearStorefrontPassword();
  res.status(204).end();
});

/**
 * Mint a share link, returning the full URL exactly once — the same handling
 * as the webhook signing secret from task 14, for the same reason. Minting a
 * new one replaces the old, so there is only ever one live link.
 */
adminRouter.post("/storefront/share-link", async (_req, res) => {
  const token = randomBytes(32).toString("base64url");
  await setStorefrontShareToken(hashToken(token));

  const url = new URL(`/?preview=${token}`, env.PUBLIC_URL).toString();
  res.status(201).json({ url });
});

adminRouter.delete("/storefront/share-link", async (_req, res) => {
  await clearStorefrontShareToken();
  res.status(204).end();
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
    const result = await syncProductToStripe(product);
    await emitProductPublished(product, result.stripeProductId);
    res.json(result);
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

const CSV_COLUMNS = [
  "order_reference",
  "order_id",
  "placed_at",
  "status",
  "email",
  "product_name",
  "variant_label",
  "options",
  "quantity",
  "unit_price_cents",
  "line_total_cents",
  "order_subtotal_cents",
  "order_shipping_cents",
  "order_tax_cents",
  "order_discount_cents",
  "order_total_cents",
  "order_refunded_cents",
  "currency",
  "shipping_name",
  "shipping_line1",
  "shipping_line2",
  "shipping_city",
  "shipping_state",
  "shipping_postal_code",
  "shipping_country",
  "carrier",
  "tracking_number",
  "oversold",
] as const;

/**
 * A merchant with more orders than this needs a date range, which is what
 * `from` and `to` are for. Without a cap, one request could stream for hours.
 */
const CSV_ROW_CAP = 50_000;

/**
 * Orders as CSV, one row per order *line* so the file pivots usefully.
 *
 * Registered before `/orders/:id` on purpose: Express matches in order, so with
 * these the other way round "orders.csv" would arrive as an order id and the
 * export would 404 with no hint why.
 *
 * Every money column is named `*_cents` and holds an integer. Invariant 1 does
 * not stop at the database — a column of dollars in a spreadsheet is how the
 * rounding errors get back in.
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

  // The BOM has to be the first bytes on the wire, before the header row.
  res.write(CSV_BOM);
  res.write(csvRow(CSV_COLUMNS));

  let offset = 0;
  let written = 0;
  let truncated = false;

  // Paged and streamed rather than built in memory: the whole point of this
  // file is the merchant whose order table is too big to read on screen.
  for (;;) {
    const page = await listOrders({ ...filters, limit: 100, offset });
    if (page.orders.length === 0) break;

    for (const order of page.orders) {
      const placedAt = new Date(order.createdAt).toISOString();
      const orderFields = [
        order.subtotalCents,
        order.shippingCents,
        order.taxCents,
        order.discountCents,
        order.totalCents,
        order.refundedCents,
        order.currency,
        order.shipping.name,
        order.shipping.line1,
        order.shipping.line2,
        order.shipping.city,
        order.shipping.state,
        order.shipping.postalCode,
        order.shipping.country,
        order.carrier,
        order.trackingNumber,
        order.oversold,
      ];

      // An order with no lines still deserves a row; it is exactly the kind of
      // thing a merchant is exporting in order to go and look at.
      const items = order.items.length > 0 ? order.items : [null];

      for (const item of items) {
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
            item?.productName ?? "",
            item?.variantLabel ?? "",
            item
              ? Object.entries(item.options)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join("; ")
              : "",
            item?.quantity ?? "",
            item?.unitPriceCents ?? "",
            item ? item.unitPriceCents * item.quantity : "",
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
    console.warn(
      `Order CSV export stopped at the ${CSV_ROW_CAP} row cap. Narrow it with ?from= and ?to=.`,
    );
  }

  res.end();
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

  // Cancelling gives the stock back — but only on the transition, not on every
  // save. A merchant fixing a typo in the tracking number of an already
  // cancelled order must not restock it again. `restockedAt` guards this too;
  // both belts, because the cost of getting it wrong is silent overselling.
  const consumedStock =
    order.status === "paid" || order.status === "processing" || order.status === "shipped";

  if (input.status === "cancelled" && consumedStock) {
    await restockInventoryForOrder(order.id);
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

  // Subscribers are told unconditionally — `notify` is about the *buyer's*
  // inbox, and a fulfilment system that only heard about the shipments a
  // merchant remembered to tick would be worse than useless.
  await emitOrderEvent(input.status === "cancelled" ? "order.cancelled" : "order.updated", updated);

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
    // Read only on the way to the refusal: the message quotes an amount, and a
    // figure written the store's way is the one the merchant just read off the
    // order page.
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


/* ------------------------------------------------------------------- staff */

/**
 * Administrators.
 *
 * `role` is recorded but does not gate anything: every administrator can do
 * everything, and the UI says so plainly. Gating it would multiply the
 * permission surface across every route and needs its own security-test matrix,
 * which is a separate decision — but the column exists now, so making it a
 * decision later is not also a migration.
 */
adminRouter.get("/users", async (req, res) => {
  res.json({
    users: await listAdmins(req.session.adminId!),
    invites: await listPendingInvites(),
  });
});

adminRouter.post("/users", async (req, res) => {
  let input;
  try {
    input = inviteInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  // Caught here rather than at accept time, so the admin finds out while they
  // are still looking at the form.
  if (await emailIsTaken(input.email)) {
    throw httpError(409, `${input.email} already has an account.`);
  }

  const { id, token } = await createInvite(input.email, input.role);
  const inviteUrl = new URL(`/admin/accept-invite?token=${token}`, env.PUBLIC_URL).toString();

  const settings = await getSettings();
  const storeName = settings?.name ?? "Beluga";

  // The store name is merchant-supplied and this is HTML: escaped like any
  // other value that lands in markup, so a name cannot carry tags into an inbox.
  const sent = await sendEmail(
    input.email,
    `You have been invited to help run ${storeName}`,
    `<p>You have been invited to help run <strong>${escapeHtml(storeName)}</strong>.</p>
     <p><a href="${escapeHtml(inviteUrl)}">Set your password and sign in</a>. The link works once and expires in 72 hours.</p>`,
  );

  // Without SMTP there is no way for the invitee to receive the link, so hand
  // it back to the admin to pass on. It is a credential, so it is returned
  // exactly once and only when there was no other way to deliver it.
  res.status(201).json({ id, email: input.email, ...(sent ? {} : { inviteUrl }) });
});

adminRouter.delete("/users/:id", async (req, res) => {
  const target = await findAdminById(req.params.id);
  if (!target) throw httpError(404, "That account does not exist.");

  if (target.id === req.session.adminId) {
    throw httpError(409, "You cannot remove your own account.");
  }

  // A store with no owner has nobody who can add one back.
  if (target.role === "owner" && (await countOwners()) <= 1) {
    throw httpError(409, "This is the last owner. Make someone else an owner first.");
  }

  // Order matters: sessions first, so there is no window in which the account
  // is gone but its cookie still works.
  await destroySessionsForUser(target.id);
  await deleteAdmin(target.id);

  res.status(204).end();
});

adminRouter.delete("/users/invites/:id", async (req, res) => {
  await revokeInvite(req.params.id);
  res.status(204).end();
});

/**
 * Change your own password.
 *
 * Rate-limited with the login limiter rather than the write limiter: this
 * verifies a password, so it is a guessing surface, and the write ceiling of
 * 120/minute is far too generous for that.
 */
adminRouter.put("/users/me/password", loginRateLimit, async (req, res) => {
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
  // just proved it knows the old password survives. Changing a password is
  // what someone does after a laptop goes missing, and it must actually work.
  await destroySessionsForUser(id, { except: req.sessionID });

  res.status(204).end();
});

/* ------------------------------------------------------- outbound webhooks */

/**
 * Endpoints a merchant has asked us to notify — see
 * docs/tasks/14-outbound-webhooks.md.
 *
 * The signing secret is never in a response from here. It is returned by the
 * create and roll routes exactly once, like the invite link above, and is
 * unrecoverable afterwards: `toEndpointSummary` strips it on the way out so
 * one forgotten field in one response shape cannot leak it.
 */
adminRouter.get("/webhooks", async (_req, res) => {
  const endpoints = await listEndpoints();
  res.json({ endpoints: endpoints.map(toEndpointSummary) });
});

adminRouter.post("/webhooks", async (req, res) => {
  let input;
  try {
    input = webhookEndpointInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  // Resolves the hostname and refuses a private or reserved address. Done here
  // rather than only at delivery time so a merchant finds out while they are
  // still looking at the form — but delivery re-checks anyway, because DNS
  // moves.
  let url: URL;
  try {
    url = await assertDeliverableUrl(input.url);
  } catch (error) {
    toHttp(error);
  }

  const secret = generateSigningSecret();
  const endpoint = await createEndpoint({
    url: url.toString(),
    description: input.description,
    eventTypes: input.eventTypes,
    enabled: input.enabled,
    secret,
  });

  // The one and only time this value is ever sent anywhere.
  res.status(201).json({ endpoint: toEndpointSummary(endpoint), secret });
});

adminRouter.put("/webhooks/:id", async (req, res) => {
  const existing = await findEndpoint(req.params.id);
  if (!existing) throw httpError(404, "That webhook endpoint does not exist.");

  let input;
  try {
    input = webhookEndpointInputSchema.parse(req.body);
  } catch (error) {
    toHttp(error);
  }

  let url: URL;
  try {
    url = await assertDeliverableUrl(input.url);
  } catch (error) {
    toHttp(error);
  }

  await updateEndpoint(existing.id, {
    url: url.toString(),
    description: input.description,
    eventTypes: input.eventTypes,
    enabled: input.enabled,
  });

  const updated = await findEndpoint(existing.id);
  if (!updated) throw httpError(404, "That webhook endpoint does not exist.");

  res.json({ endpoint: toEndpointSummary(updated) });
});

/**
 * Mint a new signing key.
 *
 * The only way back from a lost secret, and the reason losing one is not a
 * dead end. The old key stops verifying the moment this returns, so a merchant
 * should expect failed deliveries until they have pasted the new one in.
 */
adminRouter.post("/webhooks/:id/secret", async (req, res) => {
  const existing = await findEndpoint(req.params.id);
  if (!existing) throw httpError(404, "That webhook endpoint does not exist.");

  const secret = generateSigningSecret();
  await rotateEndpointSecret(existing.id, secret);

  res.json({ secret });
});

adminRouter.delete("/webhooks/:id", async (req, res) => {
  const existing = await findEndpoint(req.params.id);
  if (!existing) throw httpError(404, "That webhook endpoint does not exist.");

  await deleteEndpoint(existing.id);
  res.status(204).end();
});

/**
 * The delivery log.
 *
 * Summaries only: the stored payload is a snapshot of an order, and there is
 * no reason to re-serve customer addresses through a second route when the
 * orders pages already own that.
 */
adminRouter.get("/webhooks/:id/deliveries", async (req, res) => {
  const existing = await findEndpoint(req.params.id);
  if (!existing) throw httpError(404, "That webhook endpoint does not exist.");

  const deliveries = await listDeliveries(existing.id, 50);
  res.json({ deliveries: deliveries.map(toDeliverySummary) });
});

/** "Redeliver this one" — the whole of the retry UI the brief allows for. */
adminRouter.post("/webhooks/deliveries/:id/redeliver", async (req, res) => {
  const delivery = await findDelivery(req.params.id);
  if (!delivery) throw httpError(404, "That delivery does not exist.");

  await resetDelivery(delivery.id);

  const queued = await findDelivery(delivery.id);
  if (!queued) throw httpError(404, "That delivery does not exist.");

  res.json({ delivery: toDeliverySummary(queued) });
});
