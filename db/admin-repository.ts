import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, max, ne } from "drizzle-orm";
import type { CollectionInput, ProductInput, SettingsInput } from "../shared/api.js";
import { regenerateLabel } from "../shared/product-options.js";
import { taxSignature } from "../shared/tax.js";
import { getDatabase } from "./client.js";
import { getSettings } from "./repository.js";

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
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    // Derived, not taken from the request: see the deprecation note on the
    // column itself.
    variantName: input.options[0]?.name ?? null,
    taxCode: input.taxCode,
    isLive: input.isLive,
    position: await nextPosition(schema.products, schema.products.position),
  });

  const valuesByAxis = await writeProductOptions(id, input);
  await writeVariants(id, input, valuesByAxis);
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
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      variantName: input.options[0]?.name ?? null,
      taxCode: input.taxCode,
      isLive: input.isLive,
    })
    .where(eq(schema.products.id, id));

  const valuesByAxis = await writeProductOptions(id, input);
  await writeVariants(id, input, valuesByAxis);
  await writeOptionGroups(id, input);
}

/**
 * Replace a product's priced axes.
 *
 * Always delete-and-recreate, like `writeOptionGroups` — an axis's values are
 * never edited in place, they are declared fresh on every save. Deleting the
 * old `product_options` rows cascades away the old `product_option_values`
 * *and* the `variant_option_values` links that pointed at them, so those links
 * never need to be cleaned up by hand.
 *
 * Returns, per axis (in order), a map from value text to the freshly-minted
 * value id — what `writeVariants` needs to link each variant to the values it
 * names.
 */
async function writeProductOptions(
  productId: string,
  input: ProductInput,
): Promise<Map<string, string>[]> {
  const { drizzle: db, schema } = await getDatabase();

  await db.delete(schema.productOptions).where(eq(schema.productOptions.productId, productId));

  const valuesByAxis: Map<string, string>[] = [];

  for (const [optionIndex, option] of input.options.entries()) {
    const optionId = randomUUID();
    await db.insert(schema.productOptions).values({
      id: optionId,
      productId,
      name: option.name,
      position: optionIndex,
    });

    const byValue = new Map<string, string>();
    for (const [valueIndex, value] of option.values.entries()) {
      const valueId = randomUUID();
      await db.insert(schema.productOptionValues).values({
        id: valueId,
        optionId,
        value,
        position: valueIndex,
      });
      byValue.set(value, valueId);
    }

    valuesByAxis.push(byValue);
  }

  return valuesByAxis;
}

/**
 * Replace a product's variants.
 *
 * Existing ids are preserved so that a Stripe price already linked to a
 * variant survives an edit; only genuinely new rows get fresh ids. Labels are
 * regenerated from the selected axis values rather than trusted from the
 * request, so "Small / Blue" always matches what was actually chosen.
 */
async function writeVariants(
  productId: string,
  input: ProductInput,
  valuesByAxis: Map<string, string>[],
): Promise<void> {
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
      label: input.options.length > 0 ? regenerateLabel(variant.optionValues) : variant.label,
      priceCents: variant.priceCents,
      inventoryType: variant.inventory.type,
      inventoryQuantity: variant.inventory.type === "finite" ? variant.inventory.quantity : 0,
      weightGrams: variant.weightGrams,
      position: index,
    };

    const variantId = variant.id && keep.has(variant.id) ? variant.id : randomUUID();

    if (variant.id && keep.has(variant.id)) {
      await db.update(schema.variants).set(values).where(eq(schema.variants.id, variant.id));
    } else {
      await db.insert(schema.variants).values({ id: variantId, ...values });
    }

    for (const [axisIndex, selected] of variant.optionValues.entries()) {
      const valueId = valuesByAxis[axisIndex]?.get(selected);
      if (!valueId) continue; // Validated in the route; defensive here only.

      await db.insert(schema.variantOptionValues).values({
        variantId,
        optionValueId: valueId,
      });
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

/** The product's Stripe id, read before a delete so it can be archived. */
export async function getStripeProductId(id: string): Promise<string | null> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db
    .select({ stripeProductId: schema.products.stripeProductId })
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1)) as unknown as { stripeProductId: string | null }[];
  return rows[0]?.stripeProductId ?? null;
}

export async function addProductImage(
  productId: string,
  image: { path: string; width: number; height: number; alt: string; widths?: number[] },
): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const existing = (await db
    .select({ position: schema.productImages.position })
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, productId))) as unknown as { position: number }[];

  const { widths = [], ...rest } = image;

  await db.insert(schema.productImages).values({
    id: randomUUID(),
    productId,
    ...rest,
    widths: jsonFor(dialect === "pg", widths),
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

export async function updateProductImageAlt(
  productId: string,
  imagePath: string,
  alt: string,
): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ id: schema.productImages.id })
    .from(schema.productImages)
    .where(
      and(eq(schema.productImages.productId, productId), eq(schema.productImages.path, imagePath)),
    )
    .limit(1)) as unknown as { id: string }[];

  const row = rows[0];
  if (!row) return false;

  await db.update(schema.productImages).set({ alt }).where(eq(schema.productImages.id, row.id));
  return true;
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
    taxEnabled: input.taxEnabled,
    taxBehavior: input.taxBehavior,
    defaultTaxCode: input.defaultTaxCode,
    cartRecoveryEnabled: input.cartRecoveryEnabled,
    cartRecoveryDelayHours: input.cartRecoveryDelayHours,
    themeColorPrimary: input.theme.colorPrimary,
    themeColorAccent: input.theme.colorAccent,
    themeFontFamily: input.theme.fontFamily,
    themeBorderRadius: input.theme.borderRadius,
    themeColorScheme: input.theme.colorScheme,
    themeColorPage: input.theme.colorPage,
    themeLogoPath: input.theme.logo?.path ?? null,
    themeLogoWidth: input.theme.logo?.width ?? null,
    themeLogoHeight: input.theme.logo?.height ?? null,
    themeLogoAlt: input.theme.logo?.alt ?? null,
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

export interface AdminProductSummary {
  id: string;
  name: string;
  slug: string;
  isLive: boolean;
  /**
   * Published to Stripe under tax settings the store no longer uses.
   *
   * `tax_behavior` is immutable on a Stripe Price, so bringing a product up to
   * date means new Prices — which only an explicit publish creates. Computing
   * this here rather than auto-republishing is the same rule the publish gate
   * has always enforced: nothing writes to a live Stripe account unasked.
   */
  needsTaxRepublish: boolean;
}

export async function listAllProductsForAdmin(): Promise<AdminProductSummary[]> {
  const { drizzle: db, schema } = await getDatabase();
  const settings = await getSettings();

  const rows = (await db
    .select({
      id: schema.products.id,
      name: schema.products.name,
      slug: schema.products.slug,
      isLive: schema.products.isLive,
      taxCode: schema.products.taxCode,
      stripeProductId: schema.products.stripeProductId,
      stripeTaxSignature: schema.products.stripeTaxSignature,
    })
    .from(schema.products)
    .orderBy(asc(schema.products.position))) as unknown as {
    id: string;
    name: string;
    slug: string;
    isLive: unknown;
    taxCode: string | null;
    stripeProductId: string | null;
    stripeTaxSignature: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    isLive: row.isLive === true || row.isLive === 1,
    needsTaxRepublish:
      settings !== null &&
      settings.taxEnabled &&
      row.stripeProductId !== null &&
      row.stripeTaxSignature !==
        taxSignature(row.taxCode ?? settings.defaultTaxCode, settings.taxBehavior),
  }));
}

/**
 * Turn every pre-existing single-axis product into the options/values shape,
 * once. A data step run from `db/migrate.ts` on every boot, not a one-off
 * script — see the note there on why.
 *
 * Idempotent by construction: a product that already has a `product_options`
 * row is left alone. A product whose one variant has an empty label is left
 * with no options at all — that is the "nothing to choose" case, and it must
 * stay that way, or every simple product grows a meaningless selector.
 *
 * Returns how many products were backfilled, so the dual-dialect test can
 * assert a second run does nothing further.
 */
export async function backfillProductOptions(): Promise<number> {
  const { drizzle: db, schema } = await getDatabase();

  const products = (await db
    .select({ id: schema.products.id, variantName: schema.products.variantName })
    .from(schema.products)) as unknown as { id: string; variantName: string | null }[];

  if (products.length === 0) return 0;
  const productIds = products.map((p) => p.id);

  const [optionRows, variantRows] = await Promise.all([
    db
      .select({ productId: schema.productOptions.productId })
      .from(schema.productOptions)
      .where(inArray(schema.productOptions.productId, productIds)) as unknown as Promise<
      { productId: string }[]
    >,
    db
      .select({
        id: schema.variants.id,
        productId: schema.variants.productId,
        label: schema.variants.label,
      })
      .from(schema.variants)
      .where(inArray(schema.variants.productId, productIds))
      .orderBy(asc(schema.variants.position)) as unknown as Promise<
      { id: string; productId: string; label: string }[]
    >,
  ]);

  const alreadyHasOptions = new Set(optionRows.map((r) => r.productId));

  const variantsByProduct = new Map<string, { id: string; label: string }[]>();
  for (const variant of variantRows) {
    const list = variantsByProduct.get(variant.productId);
    if (list) list.push(variant);
    else variantsByProduct.set(variant.productId, [variant]);
  }

  let backfilled = 0;

  for (const product of products) {
    if (alreadyHasOptions.has(product.id)) continue;

    const variants = variantsByProduct.get(product.id) ?? [];
    if (variants.length === 0) continue;
    if (variants.length === 1 && variants[0]!.label === "") continue;

    const optionId = randomUUID();
    await db.insert(schema.productOptions).values({
      id: optionId,
      productId: product.id,
      name: product.variantName?.trim() || "Option",
      position: 0,
    });

    const valueIdByLabel = new Map<string, string>();

    for (const variant of variants) {
      let valueId = valueIdByLabel.get(variant.label);
      if (!valueId) {
        valueId = randomUUID();
        await db.insert(schema.productOptionValues).values({
          id: valueId,
          optionId,
          value: variant.label,
          position: valueIdByLabel.size,
        });
        valueIdByLabel.set(variant.label, valueId);
      }

      await db
        .insert(schema.variantOptionValues)
        .values({ variantId: variant.id, optionValueId: valueId });
    }

    backfilled += 1;
  }

  return backfilled;
}
