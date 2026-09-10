import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
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
export async function findOrphanDesigns(cutoff: Date, limit: number): Promise<Design[]> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const bound = dialect === "pg" ? cutoff : Math.floor(cutoff.getTime() / 1000);

  const rows = (await db
    .select()
    .from(schema.postcardDesigns)
    .where(and(isNull(schema.postcardDesigns.orderId), lt(schema.postcardDesigns.createdAt, bound)))
    .limit(limit)) as unknown as DesignRow[];

  return rows.map(buildDesign);
}

/**
 * Ordered designs that still hold a print file, so the sweep can ask whether
 * every card of each has gone out. The print file is the large one; the
 * thumbnail stays until the order itself is old.
 */
export async function findOrderedDesignsWithPrintFile(limit: number): Promise<Design[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.postcardDesigns)
    .where(and(isNotNull(schema.postcardDesigns.orderId), isNotNull(schema.postcardDesigns.printPath)))
    .limit(limit)) as unknown as DesignRow[];

  return rows.map(buildDesign);
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
