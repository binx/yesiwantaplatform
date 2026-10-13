import { randomUUID } from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import { postcardDesignSchema, orientationSchema, type PostcardDesign, type Orientation } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { toCount, toEpochMs } from "./repository.js";

/**
 * Postcard designs — the front picture of a card, as an artist uploaded it.
 *
 * A design belongs to one artist and is a card in one of their editions;
 * once an edition is on sale its cards are fixed, and once mailed a design
 * is kept forever, because it is what every collector's account shows.
 * Deleting is allowed only while nothing refers to it. What prints on the
 * back is not here: the edition card holds the title and the artist's
 * profile the name.
 */

export interface DesignRow {
  id: string;
  artistId: string;
  orientation: string;
  printPath: string;
  thumbnailPath: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
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
    createdAt: toEpochMs(row.createdAt),
  };
}

/** What anyone may see of a design: the thumbnail, never the print path. */
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
}

export async function createDesign(input: CreateDesignInput, id = randomUUID()): Promise<Design> {
  const { drizzle: db, schema } = await getDatabase();

  await db.insert(schema.postcardDesigns).values({
    id,
    artistId: input.artistId,
    orientation: input.orientation,
    printPath: input.printPath,
    thumbnailPath: input.thumbnailPath,
    thumbnailWidth: input.thumbnailWidth,
    thumbnailHeight: input.thumbnailHeight,
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

/** Whether any edition, in any state, has this design as one of its cards. */
export async function designIsUsed(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ value: count() })
    .from(schema.editionCards)
    .where(eq(schema.editionCards.designId, id))) as unknown as { value: unknown }[];
  return toCount(rows[0]?.value) > 0;
}

export async function deleteDesign(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.postcardDesigns).where(eq(schema.postcardDesigns.id, id));
}
