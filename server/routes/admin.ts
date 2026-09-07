import { Router } from "express";
import { ZodError } from "zod";
import {
  collectionInputSchema,
  imageInputSchema,
  imagePathInputSchema,
  imageReorderInputSchema,
  productInputSchema,
  reorderInputSchema,
  settingsInputSchema,
} from "../../shared/api.js";
import {
  SlugTakenError,
  addProductImage,
  collectionExists,
  createCollection,
  createProduct,
  deleteCollection,
  deleteProduct,
  listAllProductsForAdmin,
  productExists,
  removeProductImage,
  reorderCollections,
  reorderProductImages,
  reorderProducts,
  updateCollection,
  updateProduct,
  updateSettings,
} from "../../db/admin-repository.js";
import { findProductBySlug, getSettings, listCollections, listProducts } from "../../db/repository.js";
import { httpError, requireAdmin, verifyCsrf, writeRateLimit } from "../middleware.js";
import { deleteImageFile, storeImage, uploadMiddleware } from "../uploads.js";

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
  if (error instanceof ZodError) {
    const first = error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.");
  }
  throw error;
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

  const paths = await deleteProduct(req.params.id);
  // Best-effort file cleanup; the database is already consistent.
  await Promise.all(paths.map((p) => deleteImageFile(p).catch(() => undefined)));

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
