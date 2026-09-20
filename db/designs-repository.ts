import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  postcardDesignSchema,
  postcardBackSchema,
  orientationSchema,
  type PostcardBack,
  type PostcardDesign,
  type Orientation,
} from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { affectedRows, jsonFor, parseJson, toCount, toEpochMs } from "./repository.js";

/**
 * Postcard designs — the front image and back message an artist saved.
 *
 * A design belongs to one artist and may be queued as at most one mailing at
 * a time; once mailed it is kept forever, because it is what the gallery and
 * every subscriber's account show. Deleting is allowed only while nothing
 * refers to it.
 */

export interface DesignRow {
  id: string;
  artistId: string;
  orientation: string;
  printPath: string;
  thumbnailPath: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  back: unknown;
  createdAt: unknown;
}

/** The row with its paths — for the server. Visitors get `toPublicDesign`. */
export interface Design {
  id: string;
  artistId: string;
  orientation: Orientation;
  printPath: string;
  thumbnailPath: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  back: PostcardBack;
  createdAt: number;
}

function buildDesign(row: DesignRow): Design {
  return {
    id: row.id,
    artistId: row.artistId,
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

/** What anyone may see of a design: the thumbnail and the message, never the print path. */
export function toPublicDesign(design: Design, alt = "A postcard"): PostcardDesign {
  return postcardDesignSchema.parse({
    id: design.id,
    orientation: design.orientation,
    thumbnail: {
      path: design.thumbnailPath,
      width: design.thumbnailWidth,
      height: design.thumbnailHeight,
      alt,
      widths: [],
    },
    back: design.back,
    createdAt: design.createdAt,
  });
}

export interface CreateDesignInput {
  artistId: string;
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
    artistId: input.artistId,
    orientation: input.orientation,
    printPath: input.printPath,
    thumbnailPath: input.thumbnailPath,
    thumbnailWidth: input.thumbnailWidth,
    thumbnailHeight: input.thumbnailHeight,
    back: jsonFor(dialect, input.back) as never,
  });

  const created = await getDesign(id);
  if (!created) throw new Error("The design was not written.");
  return created;
}

export async function getDesign(id: string): Promise<Design | null> {
  const [design] = await findDesignsByIds([id]);
  return design ?? null;
}

/** One of this artist's designs, or null — never someone else's. */
export async function getDesignForArtist(id: string, artistId: string): Promise<Design | null> {
  const design = await getDesign(id);
  return design && design.artistId === artistId ? design : null;
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

/** This artist's designs, newest first. An artist's whole body of work fits in one list. */
export async function listDesignsForArtist(artistId: string): Promise<Design[]> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select()
    .from(schema.postcardDesigns)
    .where(eq(schema.postcardDesigns.artistId, artistId))
    .orderBy(desc(schema.postcardDesigns.createdAt), desc(schema.postcardDesigns.id))) as unknown as DesignRow[];
  return rows.map(buildDesign);
}

/** Change the back of a design. Refused once it is on a mailing that is not queued: what was printed is the record. */
export async function updateDesignBack(id: string, artistId: string, back: PostcardBack): Promise<boolean> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const result = await db
    .update(schema.postcardDesigns)
    .set({ back: jsonFor(dialect, back) as never })
    .where(and(eq(schema.postcardDesigns.id, id), eq(schema.postcardDesigns.artistId, artistId)));

  return affectedRows(result) === 1;
}

/** Whether any mailing — queued, mailed or cancelled — refers to this design. */
export async function designIsUsed(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ value: count() })
    .from(schema.mailings)
    .where(eq(schema.mailings.designId, id))) as unknown as { value: unknown }[];
  return toCount(rows[0]?.value) > 0;
}

/** Whether this design has been mailed: on a mailing past `queued`. */
export async function designIsMailed(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ value: count() })
    .from(schema.mailings)
    .where(and(eq(schema.mailings.designId, id), eq(schema.mailings.status, "mailed")))) as unknown as { value: unknown }[];
  return toCount(rows[0]?.value) > 0;
}

export async function deleteDesign(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.postcardDesigns).where(eq(schema.postcardDesigns.id, id));
}
