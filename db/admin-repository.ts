import { randomUUID } from "node:crypto";
import { and, asc, eq, max, ne } from "drizzle-orm";
import type { CollectionInput, ProductInput, SettingsInput } from "../shared/api.js";
import { getDatabase } from "./client.js";

/**
 * Admin writes.
 *
 * Every function here is reachable only behind `requireAdmin` and a CSRF
 * check; in v1 the equivalent routes had neither.
 */

function jsonFor(isPg: boolean, value: unknown): unknown {
  return isPg ? value : JSON.stringify(value);
}

async function nextPosition(table: unknown, column: unknown): Promise<number> {
  const { drizzle: db } = await getDatabase();
  const rows = (await db
    .select({ value: max(column as never) })
    .from(table)) as unknown as { value: number | null }[];
  return (rows[0]?.value ?? -1) + 1;
}

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`The slug "${slug}" is already in use.`);
    this.name = "SlugTakenError";
  }
}

async function assertSlugFree(
  kind: "product" | "collection",
  slug: string,
  excludeId?: string,
): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  const table = kind === "product" ? schema.products : schema.collections;

  const filters = [eq(table.slug, slug)];
  if (excludeId) filters.push(ne(table.id, excludeId));

  const rows = (await db
    .select({ id: table.id })
    .from(table)
    .where(and(...filters))
    .limit(1)) as unknown as { id: string }[];

  if (rows.length > 0) throw new SlugTakenError(slug);
}

export async function createProduct(input: ProductInput): Promise<string> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const json = (v: unknown) => jsonFor(dialect === "pg", v);

  await assertSlugFree("product", input.slug);

  const id = randomUUID();
  await db.insert(schema.products).values({
    id,
    slug: input.slug,
    name: input.name,
    description: input.description,
    bulletPoints: json(input.bulletPoints),
    variantName: input.variantName,
    isLive: input.isLive,
    position: await nextPosition(schema.products, schema.products.position),
  });

  await writeVariants(id, input);
  await writeOptionGroups(id, input);

  return id;
}

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const json = (v: unknown) => jsonFor(dialect === "pg", v);

  await assertSlugFree("product", input.slug, id);

  await db
    .update(schema.products)
    .set({
      slug: input.slug,
      name: input.name,
      description: input.description,
      bulletPoints: json(input.bulletPoints),
      variantName: input.variantName,
      isLive: input.isLive,
    })
    .where(eq(schema.products.id, id));

  await writeVariants(id, input);
  await writeOptionGroups(id, input);
}

/**
 * Replace a product's variants.
 *
 * Existing ids are preserved so that a Stripe price already linked to a
 * variant survives an edit; only genuinely new rows get fresh ids.
 */
async function writeVariants(productId: string, input: ProductInput): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  const existing = (await db
    .select({ id: schema.variants.id })
    .from(schema.variants)
    .where(eq(schema.variants.productId, productId))) as unknown as { id: string }[];

  const keep = new Set(input.variants.map((v) => v.id).filter(Boolean) as string[]);

  for (const row of existing) {
    if (!keep.has(row.id)) {
      await db.delete(schema.variants).where(eq(schema.variants.id, row.id));
    }
  }

  for (const [index, variant] of input.variants.entries()) {
    const values = {
      productId,
      label: variant.label,
      priceCents: variant.priceCents,
      inventoryType: variant.inventory.type,
      inventoryQuantity: variant.inventory.type === "finite" ? variant.inventory.quantity : 0,
      position: index,
    };

    if (variant.id && keep.has(variant.id)) {
      await db.update(schema.variants).set(values).where(eq(schema.variants.id, variant.id));
    } else {
      await db.insert(schema.variants).values({ id: randomUUID(), ...values });
    }
  }
}

async function writeOptionGroups(productId: string, input: ProductInput): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const json = (v: unknown) => jsonFor(dialect === "pg", v);

  await db.delete(schema.optionGroups).where(eq(schema.optionGroups.productId, productId));

  for (const [index, group] of input.optionGroups.entries()) {
    await db.insert(schema.optionGroups).values({
      id: randomUUID(),
      productId,
      name: group.name,
      choices: json(group.choices),
      position: index,
    });
  }
}

/** Returns the image paths that should now be removed from disk. */
export async function deleteProduct(id: string): Promise<string[]> {
  const { drizzle: db, schema } = await getDatabase();

  const images = (await db
    .select({ path: schema.productImages.path })
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, id))) as unknown as { path: string }[];

  // Variants, images, option groups and collection links cascade.
  await db.delete(schema.products).where(eq(schema.products.id, id));

  return images.map((i) => i.path);
}

export async function setProductLive(id: string, isLive: boolean): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.update(schema.products).set({ isLive }).where(eq(schema.products.id, id));
}

export async function productExists(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1)) as unknown as { id: string }[];
  return rows.length > 0;
}

export async function addProductImage(
  productId: string,
  image: { path: string; width: number; height: number; alt: string },
): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  const existing = (await db
    .select({ position: schema.productImages.position })
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, productId))) as unknown as { position: number }[];

  await db.insert(schema.productImages).values({
    id: randomUUID(),
    productId,
    ...image,
    position: existing.length,
  });
}

/** Returns the stored path so the caller can remove the file. */
export async function removeProductImage(
  productId: string,
  imagePath: string,
): Promise<string | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.productImages)
    .where(
      and(
        eq(schema.productImages.productId, productId),
        eq(schema.productImages.path, imagePath),
      ),
    )
    .limit(1)) as unknown as { id: string; path: string }[];

  const row = rows[0];
  if (!row) return null;

  await db.delete(schema.productImages).where(eq(schema.productImages.id, row.id));
  return row.path;
}

export async function reorderProductImages(productId: string, paths: string[]): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  for (const [index, imagePath] of paths.entries()) {
    await db
      .update(schema.productImages)
      .set({ position: index })
      .where(
        and(
          eq(schema.productImages.productId, productId),
          eq(schema.productImages.path, imagePath),
        ),
      );
  }
}

export async function createCollection(input: CollectionInput): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();

  await assertSlugFree("collection", input.slug);

  const id = randomUUID();
  await db.insert(schema.collections).values({
    id,
    slug: input.slug,
    name: input.name,
    position: await nextPosition(schema.collections, schema.collections.position),
  });

  await setCollectionProducts(id, input.productIds);
  return id;
}

export async function updateCollection(id: string, input: CollectionInput): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await assertSlugFree("collection", input.slug, id);

  await db
    .update(schema.collections)
    .set({ slug: input.slug, name: input.name })
    .where(eq(schema.collections.id, id));

  await setCollectionProducts(id, input.productIds);
}

export async function setCollectionProducts(
  collectionId: string,
  productIds: string[],
): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .delete(schema.collectionProducts)
    .where(eq(schema.collectionProducts.collectionId, collectionId));

  // De-duplicate: the join table's composite key would reject repeats.
  const unique = [...new Set(productIds)];

  for (const [index, productId] of unique.entries()) {
    await db
      .insert(schema.collectionProducts)
      .values({ collectionId, productId, position: index });
  }
}

export async function deleteCollection(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.collections).where(eq(schema.collections.id, id));
}

export async function collectionExists(id: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ id: schema.collections.id })
    .from(schema.collections)
    .where(eq(schema.collections.id, id))
    .limit(1)) as unknown as { id: string }[];
  return rows.length > 0;
}

export async function reorderCollections(ids: string[]): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  for (const [index, id] of ids.entries()) {
    await db.update(schema.collections).set({ position: index }).where(eq(schema.collections.id, id));
  }
}

export async function reorderProducts(ids: string[]): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  for (const [index, id] of ids.entries()) {
    await db.update(schema.products).set({ position: index }).where(eq(schema.products.id, id));
  }
}

export async function updateSettings(input: SettingsInput): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  const values = {
    name: input.name,
    currency: input.currency,
    stripePublishableKey: input.stripePublishableKey,
    aboutText: input.aboutText,
    themeColorPrimary: input.theme.colorPrimary,
    themeColorAccent: input.theme.colorAccent,
    themeFontFamily: input.theme.fontFamily,
    themeBorderRadius: input.theme.borderRadius,
  };

  const existing = (await db
    .select({ id: schema.storeSettings.id })
    .from(schema.storeSettings)
    .limit(1)) as unknown as { id: number }[];

  if (existing.length === 0) {
    await db.insert(schema.storeSettings).values({ id: 1, ...values });
  } else {
    await db.update(schema.storeSettings).set(values).where(eq(schema.storeSettings.id, 1));
  }
}

export async function listAllProductsForAdmin(): Promise<
  { id: string; name: string; slug: string; isLive: boolean }[]
> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      id: schema.products.id,
      name: schema.products.name,
      slug: schema.products.slug,
      isLive: schema.products.isLive,
    })
    .from(schema.products)
    .orderBy(asc(schema.products.position))) as unknown as {
    id: string;
    name: string;
    slug: string;
    isLive: unknown;
  }[];

  return rows.map((r) => ({ ...r, isLive: r.isLive === true || r.isLive === 1 }));
}
