import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import type { CollectionInput, ProductInput, SettingsInput } from "../shared/api.js";
import { collectionDraftSchema, type CollectionDraft, type ProductKind } from "../shared/schema.js";
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

export class SkuTakenError extends Error {
  constructor(sku: string, otherProductName: string) {
    super(`The SKU "${sku}" is already used by "${otherProductName}".`);
    this.name = "SkuTakenError";
  }
}

/**
 * Checked before any write, not left to the partial unique index alone:
 * `writeVariants` inserts and updates row by row with no transaction, so a
 * violation partway through would leave a half-written product. Two passes —
 * within the incoming variants first (the index can't see a duplicate until
 * both rows exist), then against every other product's variants.
 */
async function assertSkuFree(input: ProductInput, excludeProductId?: string): Promise<void> {
  const skus = input.variants.map((v) => v.sku).filter((sku): sku is string => sku !== null);
  if (skus.length === 0) return;

  const seen = new Set<string>();
  for (const sku of skus) {
    if (seen.has(sku)) {
      throw new SkuTakenError(sku, "another variant of this same product");
    }
    seen.add(sku);
  }

  const { drizzle: db, schema } = await getDatabase();

  const filters = [inArray(schema.variants.sku, skus)];
  if (excludeProductId) filters.push(ne(schema.variants.productId, excludeProductId));

  const rows = (await db
    .select({ sku: schema.variants.sku, productName: schema.products.name })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.variants.productId, schema.products.id))
    .where(and(...filters))
    .limit(1)) as unknown as { sku: string; productName: string }[];

  const row = rows[0];
  if (row) throw new SkuTakenError(row.sku, row.productName);
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
  await assertSkuFree(input);

  const id = randomUUID();
  await db.insert(schema.products).values({
    id,
    slug: input.slug,
    name: input.name,
    description: input.description,
    bulletPoints: json(input.bulletPoints),
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    kind: input.kind,
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
  await assertSkuFree(input, id);

  await db
    .update(schema.products)
    .set({
      slug: input.slug,
      name: input.name,
      description: input.description,
      bulletPoints: json(input.bulletPoints),
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      kind: input.kind,
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
      sku: variant.sku,
      compareAtPriceCents: variant.compareAtPriceCents,
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

export class VariantOwnershipError extends Error {
  constructor() {
    super("That variant does not belong to this product.");
    this.name = "VariantOwnershipError";
  }
}

/**
 * Alt text and variant assignment, patched independently: an absent key is
 * left alone rather than cleared, so one can change without resending the
 * other.
 */
export async function updateProductImage(
  productId: string,
  imagePath: string,
  patch: { alt?: string; variantId?: string | null },
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

  // The foreign key alone would let an image point at another product's
  // variant, where it could never be selected on the storefront.
  if (patch.variantId) {
    const owned = (await db
      .select({ id: schema.variants.id })
      .from(schema.variants)
      .where(
        and(eq(schema.variants.id, patch.variantId), eq(schema.variants.productId, productId)),
      )
      .limit(1)) as unknown as { id: string }[];

    if (owned.length === 0) throw new VariantOwnershipError();
  }

  const values: { alt?: string; variantId?: string | null } = {};
  if (patch.alt !== undefined) values.alt = patch.alt;
  if (patch.variantId !== undefined) values.variantId = patch.variantId;

  if (Object.keys(values).length > 0) {
    await db.update(schema.productImages).set(values).where(eq(schema.productImages.id, row.id));
  }

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

/**
 * A cover as four columns.
 *
 * `widths` is dropped on the way in: there is no `cover_widths` column, and
 * adding one is a migration. An empty `widths` means "serve the single
 * full-size file", which is what a 16:9 tile does anyway — the derivatives
 * `storeImage` wrote are simply not advertised for covers.
 */
function coverColumns(cover: CollectionInput["cover"]) {
  return {
    coverPath: cover?.path ?? null,
    coverWidth: cover?.width ?? null,
    coverHeight: cover?.height ?? null,
    coverAlt: cover?.alt ?? null,
  };
}

/**
 * Collections as the admin edits them: Markdown source, not rendered HTML.
 *
 * The mirror of `listPageDrafts`. `listCollections` renders on the way out for
 * the storefront; handing that same HTML to the editor would mean the next
 * save either stored HTML or silently dropped what the merchant wrote.
 */
export async function listCollectionDrafts(): Promise<CollectionDraft[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.collections)
    .orderBy(asc(schema.collections.position), asc(schema.collections.name))) as unknown as {
    id: string;
    slug: string;
    name: string;
    coverPath: string | null;
    coverWidth: number | null;
    coverHeight: number | null;
    coverAlt: string | null;
    description: string | null;
  }[];

  if (rows.length === 0) return [];

  const links = (await db
    .select()
    .from(schema.collectionProducts)
    .orderBy(asc(schema.collectionProducts.position))) as unknown as {
    collectionId: string;
    productId: string;
  }[];

  return rows.map((row) =>
    collectionDraftSchema.parse({
      id: row.id,
      slug: row.slug,
      name: row.name,
      cover:
        row.coverPath && row.coverWidth && row.coverHeight
          ? {
              path: row.coverPath,
              width: row.coverWidth,
              height: row.coverHeight,
              alt: row.coverAlt ?? "",
            }
          : null,
      description: row.description,
      productIds: links.filter((l) => l.collectionId === row.id).map((l) => l.productId),
    }),
  );
}

export async function createCollection(input: CollectionInput): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();

  await assertSlugFree("collection", input.slug);

  const id = randomUUID();
  await db.insert(schema.collections).values({
    id,
    slug: input.slug,
    name: input.name,
    description: blankToNull(input.description),
    ...coverColumns(input.cover),
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
    .set({
      slug: input.slug,
      name: input.name,
      description: blankToNull(input.description),
      ...coverColumns(input.cover),
    })
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

/** "" and "   " both mean "no value", so both become the column's null. */
function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function updateSettings(input: SettingsInput): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  const values = {
    name: input.name,
    currency: input.currency,
    locale: input.locale,
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
    themeFontUrl: input.theme.fontUrl,
    themeBorderRadius: input.theme.borderRadius,
    themeColorScheme: input.theme.colorScheme,
    themeColorPage: input.theme.colorPage,
    themeLogoPath: input.theme.logo?.path ?? null,
    themeLogoWidth: input.theme.logo?.width ?? null,
    themeLogoHeight: input.theme.logo?.height ?? null,
    themeLogoAlt: input.theme.logo?.alt ?? null,
    // Empty is not a value here: a merchant clearing the heading means "go
    // back to the store name", and storing "" would render an empty <h1>
    // instead. Null is the only way to say "use the default".
    heroHeading: blankToNull(input.hero.heading),
    heroText: blankToNull(input.hero.text),
    heroButtonLabel: blankToNull(input.hero.buttonLabel),
    heroButtonHref: blankToNull(input.hero.buttonHref),
    heroImagePath: input.hero.image?.path ?? null,
    heroImageWidth: input.hero.image?.width ?? null,
    heroImageHeight: input.hero.image?.height ?? null,
    heroImageAlt: input.hero.image?.alt ?? null,
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

/* ------------------------------------------------------- storefront access */

/**
 * Storefront visibility — see docs/tasks/27-storefront-preview-mode.md.
 *
 * Deliberately its own group of functions rather than fields on
 * `updateSettings`: that route accepts a full-object PUT with a `.default()`
 * on nearly every field, so a secret living there would be cleared by any
 * client that omitted it. Every write here also creates the settings row if
 * `updateSettings` has never run — first-run setup can lock a store before
 * it has saved anything else.
 */

async function ensureSettingsRow(): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  const existing = (await db
    .select({ id: schema.storeSettings.id })
    .from(schema.storeSettings)
    .limit(1)) as unknown as { id: number }[];

  if (existing.length === 0) await db.insert(schema.storeSettings).values({ id: 1 });
}

/** The access mode alone. Refusing "password" with no hash set is the
 * route's job, not this function's — it only ever writes what it is given. */
export async function setStorefrontAccess(access: "public" | "password"): Promise<void> {
  await ensureSettingsRow();
  const { drizzle: db, schema } = await getDatabase();
  await db.update(schema.storeSettings).set({ storefrontAccess: access }).where(eq(schema.storeSettings.id, 1));
}

/** Set or change the password. Bumps the version, so every existing viewer
 * session is out on its next request. */
export async function setStorefrontPassword(passwordHash: string): Promise<void> {
  await ensureSettingsRow();
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.storeSettings)
    .set({
      storefrontPasswordHash: passwordHash,
      storefrontAccessVersion: sql`${schema.storeSettings.storefrontAccessVersion} + 1`,
    })
    .where(eq(schema.storeSettings.id, 1));
}

/**
 * Clear the password and fall back to public.
 *
 * Leaving `access` at "password" with no hash would be a state that means
 * nothing — nobody could ever satisfy it, not even by guessing — so this
 * resets access rather than leaving that behind for something else to notice.
 */
export async function clearStorefrontPassword(): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.storeSettings)
    .set({
      storefrontAccess: "public",
      storefrontPasswordHash: null,
      storefrontAccessVersion: sql`${schema.storeSettings.storefrontAccessVersion} + 1`,
    })
    .where(eq(schema.storeSettings.id, 1));
}

/** Mint (or replace) the share link's token. Bumps the version like a
 * password change — a stale link should not go on working past a fresh one. */
export async function setStorefrontShareToken(tokenHash: string): Promise<void> {
  await ensureSettingsRow();
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.storeSettings)
    .set({
      storefrontShareToken: tokenHash,
      storefrontAccessVersion: sql`${schema.storeSettings.storefrontAccessVersion} + 1`,
    })
    .where(eq(schema.storeSettings.id, 1));
}

export async function clearStorefrontShareToken(): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.storeSettings)
    .set({
      storefrontShareToken: null,
      storefrontAccessVersion: sql`${schema.storeSettings.storefrontAccessVersion} + 1`,
    })
    .where(eq(schema.storeSettings.id, 1));
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
  /**
   * Live on the storefront with a variant that has no Stripe Price.
   *
   * The storefront will happily show it and let it be added to a cart, and
   * checkout then refuses the whole order — which the shopper sees and the
   * merchant does not. `isLive` and "published to Stripe" are separate
   * switches by design (nothing writes to a live Stripe account unasked), so
   * the combination has to be said out loud somewhere.
   */
  needsPublish: boolean;
  /**
   * Physical or digital. The Overview's "no shipping rates" warning turns on
   * it: a store selling only downloads ships nothing and needs no rates, so
   * warning it about free postage would be noise it could never act on.
   */
  kind: ProductKind;
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
      kind: schema.products.kind,
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
    kind: string;
    taxCode: string | null;
    stripeProductId: string | null;
    stripeTaxSignature: string | null;
  }[];

  // One extra read rather than a join: the set is small, and checkout refuses
  // an order per *variant* without a Price, so the product-level
  // `stripeProductId` is not the thing to test.
  const unpriced = (await db
    .select({ productId: schema.variants.productId })
    .from(schema.variants)
    .where(isNull(schema.variants.stripePriceId))) as unknown as { productId: string }[];
  const unpricedProducts = new Set(unpriced.map((row) => row.productId));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    isLive: row.isLive === true || row.isLive === 1,
    kind: row.kind === "digital" ? "digital" : "physical",
    needsPublish: (row.isLive === true || row.isLive === 1) && unpricedProducts.has(row.id),
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
