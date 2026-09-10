import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { designInputSchema } from "../../shared/api.js";
import { postcardBackSchema } from "../../shared/postcards.js";
import {
  createDesign,
  findDesignsByIds,
  getDesign,
  toPublicDesign,
  updateDesignBack,
} from "../../db/designs-repository.js";
import { httpError, uploadRateLimit, writeRateLimit } from "../middleware.js";
import { deleteDesignFile, mapUploadError, storePostcardDesign, uploadMiddleware } from "../uploads.js";

/**
 * Postcard designs.
 *
 * Public, because guest checkout is: a buyer with no account has to be able
 * to save a design before there is any order to hang it on. What keeps that
 * honest is the upload rate limit, the size and pixel caps in
 * server/uploads.ts, and the sweep in server/fulfilment.ts that deletes a
 * design nobody bought after a month.
 *
 * A design is addressed by its UUID and nothing else — the same posture as
 * the confirmation page's session id. Knowing the id is the credential; the
 * ids are unguessable; and what the id unlocks is a thumbnail and a message
 * the buyer wrote themselves.
 */
export const designsRouter: Router = Router();

/** `?ids=a,b,c` — the cart re-resolves its designs on every render. */
const idsQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(1).max(64)).max(100)),
});

designsRouter.get("/designs", async (req, res) => {
  const parsed = idsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw httpError(400, "A list of design ids is required.");

  const designs = await findDesignsByIds(parsed.data.ids);
  res.json(designs.map(toPublicDesign));
});

designsRouter.get("/designs/:id", async (req, res) => {
  const design = await getDesign(req.params.id);
  if (!design) throw httpError(404, "That design does not exist, or has been cleaned up.");
  res.json(toPublicDesign(design));
});

/**
 * Save a design: the front image as multipart `file`, plus `orientation` and
 * `back` (a JSON string) as fields.
 *
 * The print file is made here, at Lob's size and density, so an image that
 * cannot be printed is refused now — with a message that says why — rather
 * than weeks later by the fulfilment sweep, when the buyer has paid and is
 * not looking. That is the whole of what v1 got wrong about this route.
 */
designsRouter.post("/designs", uploadRateLimit, (req, res, next) => {
  uploadMiddleware(req, res, (uploadError: unknown) => {
    void (async () => {
      try {
        if (uploadError) return next(mapUploadError(uploadError));
        if (!req.file) throw httpError(400, "Choose an image for the front of the card.");

        const body = req.body as Record<string, unknown>;
        let back: unknown = {};
        if (typeof body.back === "string" && body.back !== "") {
          try {
            back = JSON.parse(body.back);
          } catch {
            throw httpError(400, "The back of the card could not be read.");
          }
        }

        const parsed = designInputSchema.safeParse({ orientation: body.orientation, back });
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid design.");
        }

        const id = randomUUID();
        const stored = await storePostcardDesign(id, req.file.buffer, parsed.data.orientation);

        try {
          const design = await createDesign(
            {
              customerId: req.session.customerId ?? null,
              orientation: parsed.data.orientation,
              back: parsed.data.back,
              ...stored,
            },
            id,
          );
          res.status(201).json(toPublicDesign(design));
        } catch (error) {
          // The files are on disk and the row is not: remove them rather than
          // leave two orphans the cleanup sweep cannot see.
          await deleteDesignFile(stored.printPath).catch(() => undefined);
          await deleteDesignFile(stored.thumbnailPath).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        next(error);
      }
    })();
  });
});

/** Edit the message on a design that has not been ordered yet. */
designsRouter.put("/designs/:id", writeRateLimit, async (req, res) => {
  const id = String(req.params.id);
  const parsed = postcardBackSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw httpError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid message.");
  }

  const design = await getDesign(id);
  if (!design) throw httpError(404, "That design does not exist, or has been cleaned up.");
  if (design.orderId) throw httpError(409, "That design has already been ordered and cannot be changed.");

  await updateDesignBack(design.id, parsed.data);
  const updated = await getDesign(design.id);
  res.json(toPublicDesign(updated!));
});
