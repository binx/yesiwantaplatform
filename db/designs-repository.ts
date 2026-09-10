import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  postcardDesignSchema,
  postcardBackSchema,
  orientationSchema,
  type PostcardBack,
  type PostcardDesign,
  type Orientation,
} from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { jsonFor, parseJson, toEpochMs } from "./repository.js";

/**
 * Postcard designs — the front image and back message a buyer saved.
 *
 * A design exists before any order does, and most designs never reach one:
 * every "let me try another photo" is a row here. The sweeps in
 * server/fulfilment.ts are what keep that honest, and the queries they need
 * live at the bottom of this file.
 */

export interface DesignRow {
  id: string;
  customerId: string | null;
  orderId: string | null;
  originId: string | null;
  orientation: string;
  printPath: string | null;
  thumbnailPath: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  back: unknown;
  createdAt: unknown;
}

/** The row with its paths — for the server. The storefront gets `toPublicDesign`. */
export interface Design {
  id: string;
  customerId: string | null;
  orderId: string | null;
  /** The design this one was duplicated from, when "send again" made it. */
  originId: string | null;
  orientation: Orientation;
  printPath: string | null;
  thumbnailPath: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  back: PostcardBack;
  createdAt: number;
}

function buildDesign(row: DesignRow): Design {
  return {
    id: row.id,
    customerId: row.customerId,
    orderId: row.orderId,
    originId: row.originId,
    orientation: orientationSchema.catch("portrait").parse(row.orientation),
    printPath: row.printPath,
    thumbnailPath: row.thumbnailPath,
    thumbnailWidth: row.thumbnailWidth,
    thumbnailHeight: row.thumbnailHeight,
    // Parsed with defaults, so a row written before a field existed still
    // renders — and a hand-edited colour that is not a colour falls back.
    back: postcardBackSchema.catch(postcardBackSchema.parse({})).parse(parseJson(row.back, {})),
    createdAt: toEpochMs(row.createdAt),
  };
}

/** What a shopper may see of a design: the thumbnail and the message, never the print path. */
export function toPublicDesign(design: Design): PostcardDesign {
  return postcardDesignSchema.parse({
    id: design.id,
    orientation: design.orientation,
    thumbnail: {
      path: design.thumbnailPath,
      width: design.thumbnailWidth,
      height: design.thumbnailHeight,
      alt: "Your postcard design",
      widths: [],
    },
    back: design.back,
    createdAt: design.createdAt,
  });
}

export interface CreateDesignInput {
  customerId: string | null;
  originId?: string | null;
  orientation: Orientation;
  printPath: string;
  thumbnailPath: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  back: PostcardBack;
}

export async function createDesign(input: CreateDesignInput, id = randomUUID()): Promise<Design> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  await db.insert(schema.postcardDesigns).values({
    id,
    customerId: input.customerId,
    originId: input.originId ?? null,
    orientation: input.orientation,
    printPath: input.printPath,
    thumbnailPath: input.thumbnailPath,
    thumbnailWidth: input.thumbnailWidth,
    thumbnailHeight: input.thumbnailHeight,
    back: jsonFor(dialect, input.back),
  });

  const created = await getDesign(id);
  if (!created) throw new Error("The design was not written.");
  return created;
}

export async function getDesign(id: string): Promise<Design | null> {
  const [design] = await findDesignsByIds([id]);
  return design ?? null;
}

/** Several designs at once, in no particular order. Missing ids are simply absent. */
export async function findDesignsByIds(ids: string[]): Promise<Design[]> {
  if (ids.length === 0) return [];

  const { drizzle: db, schema } = await getDatabase();
  const unique = [...new Set(ids)];

  const rows: DesignRow[] = [];
  // Chunked well under any driver's parameter limit.
  for (let i = 0; i < unique.length; i += 500) {
    rows.push(
      ...((await db
        .select()
        .from(schema.postcardDesigns)
        .where(inArray(schema.postcardDesigns.id, unique.slice(i, i + 500)))) as unknown as DesignRow[]),
    );
  }

  return rows.map(buildDesign);
}

/** Stamp the paid order onto its designs, so the cleanup sweep leaves them alone. */
export async function attachDesignsToOrder(designIds: string[], orderId: string): Promise<void> {
  if (designIds.length === 0) return;

  const { drizzle: db, schema } = await getDatabase();
  await db
    .update(schema.postcardDesigns)
    .set({ orderId })
    .where(and(inArray(schema.postcardDesigns.id, [...new Set(designIds)]), isNull(schema.postcardDesigns.orderId)));
}

/** Update the back of a design that has not been ordered yet. Returns false once it has. */
export async function updateDesignBack(id: string, back: PostcardBack): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const result = await db
    .update(schema.postcardDesigns)
    .set({ back: jsonFor(dialect, back) })
    .where(and(eq(schema.postcardDesigns.id, id), isNull(schema.postcardDesigns.orderId)));

  return affectedRows(result) === 1;
}

/**
 * Designs that were saved and never bought, older than the cutoff.
 *
 * `orderId` is only ever set by the payment webhook, so "no order" means the
 * buyer walked away before paying — or is still deciding, which is why the
 * cutoff is a month rather than a day.
 */
export async function findOrphanDesigns(cutoff: Date, limit: number, owner: "guest" | "customer" = "guest"): Promise<Design[]> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const bound = dialect === "pg" ? cutoff : Math.floor(cutoff.getTime() / 1000);

  const rows = (await db
    .select()
    .from(schema.postcardDesigns)
    .where(
      and(
        isNull(schema.postcardDesigns.orderId),
        owner === "guest" ? isNull(schema.postcardDesigns.customerId) : isNotNull(schema.postcardDesigns.customerId),
        lt(schema.postcardDesigns.createdAt, bound),
      ),
    )
    .limit(limit)) as unknown as DesignRow[];

  return rows.map(buildDesign);
}

/**
 * A guest's ordered designs that still hold a print file, so the sweep can
 * ask whether every card of each has gone out. The print file is the large
 * one; the thumbnail stays until the order itself is old.
 *
 * A customer's designs are left alone: the print file is what makes "send
 * again" exact, and a signed-in customer's work is not the free image host
 * the trim exists to prevent.
 */
export async function findOrderedDesignsWithPrintFile(limit: number): Promise<Design[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.postcardDesigns)
    .where(
      and(
        isNotNull(schema.postcardDesigns.orderId),
        isNotNull(schema.postcardDesigns.printPath),
        isNull(schema.postcardDesigns.customerId),
      ),
    )
    .limit(limit)) as unknown as DesignRow[];

  return rows.map(buildDesign);
}

/** A guest's orders became a customer's: their designs follow. */
export async function claimDesignsForOrders(customerId: string, orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const { drizzle: db, schema } = await getDatabase();
  const result = await db
    .update(schema.postcardDesigns)
    .set({ customerId })
    .where(and(inArray(schema.postcardDesigns.orderId, orderIds), isNull(schema.postcardDesigns.customerId)));
  return affectedRows(result);
}

/* ------------------------------------------------------------------ gallery */

/** Where a design's cards are, in one row per design. */
export interface DesignCounts {
  total: number;
  scheduled: number;
  sent: number;
  delivered: number;
  error: number;
  cancelled: number;
  firstMailDate: string | null;
  lastMailDate: string | null;
}

export interface GalleryDesign extends Design {
  postcards: DesignCounts;
  /** A print file is still here, so a copy would print exactly this. */
  canSendAgain: boolean;
}

const DELIVERED = new Set(["postcard.processed_for_delivery", "postcard.delivered"]);

/** One grouped query over the cards of many designs, not one per design. */
async function countPostcardsByDesign(designIds: string[]): Promise<Map<string, DesignCounts>> {
  const map = new Map<string, DesignCounts>();
  if (designIds.length === 0) return map;
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      designId: schema.postcards.designId,
      status: schema.postcards.status,
      trackingStatus: schema.postcards.trackingStatus,
      count: sql<number>`count(*)`,
      first: sql<string | null>`min(${schema.postcards.mailDate})`,
      last: sql<string | null>`max(${schema.postcards.mailDate})`,
    })
    .from(schema.postcards)
    .where(inArray(schema.postcards.designId, designIds))
    .groupBy(schema.postcards.designId, schema.postcards.status, schema.postcards.trackingStatus)) as unknown as {
    designId: string;
    status: string;
    trackingStatus: string | null;
    count: number | string;
    first: string | null;
    last: string | null;
  }[];

  for (const row of rows) {
    const counts = map.get(row.designId) ?? { total: 0, scheduled: 0, sent: 0, delivered: 0, error: 0, cancelled: 0, firstMailDate: null, lastMailDate: null };
    const n = Number(row.count);
    counts.total += n;
    if (row.status === "scheduled" || row.status === "sending" || row.status === "pending") counts.scheduled += n;
    else if (row.status === "sent") {
      counts.sent += n;
      if (row.trackingStatus && DELIVERED.has(row.trackingStatus)) counts.delivered += n;
    } else if (row.status === "error") counts.error += n;
    else if (row.status === "cancelled") counts.cancelled += n;
    if (row.first && (!counts.firstMailDate || row.first < counts.firstMailDate)) counts.firstMailDate = row.first;
    if (row.last && (!counts.lastMailDate || row.last > counts.lastMailDate)) counts.lastMailDate = row.last;
    map.set(row.designId, counts);
  }
  return map;
}

const EMPTY_COUNTS: DesignCounts = { total: 0, scheduled: 0, sent: 0, delivered: 0, error: 0, cancelled: 0, firstMailDate: null, lastMailDate: null };

async function withCounts(designs: Design[]): Promise<GalleryDesign[]> {
  const counts = await countPostcardsByDesign(designs.map((d) => d.id));
  return designs.map((design) => ({
    ...design,
    postcards: counts.get(design.id) ?? EMPTY_COUNTS,
    canSendAgain: design.printPath !== null,
  }));
}

/** A cursor is the last row's creation time and id, so a page is stable while designs keep arriving. */
function decodeCursor(cursor: string | undefined): { createdAt: number; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = Number(at);
  return Number.isFinite(createdAt) && id ? { createdAt, id } : null;
}

function encodeCursor(design: Design): string {
  return Buffer.from(`${design.createdAt}|${design.id}`, "utf8").toString("base64url");
}

/** This customer's designs, newest first, a page at a time. */
export async function listDesignsForCustomer(
  customerId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<{ designs: GalleryDesign[]; nextCursor: string | null }> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const after = decodeCursor(options.cursor);
  const bound = (epochMs: number) => (dialect === "pg" ? new Date(epochMs) : Math.floor(epochMs / 1000));

  const rows = (await db
    .select()
    .from(schema.postcardDesigns)
    .where(
      and(
        eq(schema.postcardDesigns.customerId, customerId),
        after
          ? or(
              lt(schema.postcardDesigns.createdAt, bound(after.createdAt)),
              and(eq(schema.postcardDesigns.createdAt, bound(after.createdAt)), lt(schema.postcardDesigns.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.postcardDesigns.createdAt), desc(schema.postcardDesigns.id))
    .limit(limit + 1)) as unknown as DesignRow[];

  const page = rows.slice(0, limit).map(buildDesign);
  const last = page[page.length - 1];
  return { designs: await withCounts(page), nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

/** One of this customer's designs, or null — never someone else's. */
export async function getDesignForCustomer(id: string, customerId: string): Promise<GalleryDesign | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.postcardDesigns)
    .where(and(eq(schema.postcardDesigns.id, id), eq(schema.postcardDesigns.customerId, customerId)))
    .limit(1)) as unknown as DesignRow[];
  const row = rows[0];
  if (!row) return null;
  const [design] = await withCounts([buildDesign(row)]);
  return design ?? null;
}

/** The copies "send again" made of a design, newest first. */
export async function listCopiesOf(originId: string, customerId: string): Promise<GalleryDesign[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.postcardDesigns)
    .where(and(eq(schema.postcardDesigns.originId, originId), eq(schema.postcardDesigns.customerId, customerId)))
    .orderBy(desc(schema.postcardDesigns.createdAt))) as unknown as DesignRow[];
  return withCounts(rows.map(buildDesign));
}

/** Remove a design that was never ordered. Returns it (for its files), or null if it is ordered or not theirs. */
export async function deleteDraftDesign(id: string, customerId: string): Promise<Design | null> {
  const design = await getDesignForCustomer(id, customerId);
  if (!design || design.orderId) return null;
  await deleteDesign(id);
  return design;
}

export async function markPrintFileRemoved(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.update(schema.postcardDesigns).set({ printPath: null }).where(eq(schema.postcardDesigns.id, id));
}

export async function deleteDesign(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.postcardDesigns).where(eq(schema.postcardDesigns.id, id));
}

/** Rows changed by an update, across both drivers. */
export function affectedRows(result: unknown): number {
  const shape = result as { changes?: number; rowCount?: number } | null;
  return shape?.changes ?? shape?.rowCount ?? 0;
}
