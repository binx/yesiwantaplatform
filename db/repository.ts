import { and, asc, count, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  collectionSchema,
  productSchema,
  storeSchema,
  taxBehaviorSchema,
  themeSchema,
  type Collection,
  type Product,
  type Store,
  type TaxBehavior,
  type Theme,
} from "../shared/schema.js";
import { countriesCovered, hasCatchAllZone } from "../shared/shipping.js";
import { getDatabase } from "./client.js";
import { listPageSummaries } from "./pages-repository.js";
import { getShippingTable } from "./shipping-repository.js";

/**
 * Catalogue access.
 *
 * The queries are written once and run against either dialect; every value
 * that leaves this module is parsed with the shared zod schemas, so a mapping
 * mistake surfaces as a validation error in the dual-dialect test run rather
 * than as bad data on the storefront.
 */

/** Cap on the catalogue embedded in a single /api/store response. */
export const STORE_SNAPSHOT_LIMIT = 200;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  // Postgres jsonb arrives decoded; SQLite stores JSON in TEXT.
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** SQLite has no boolean type; both dialects normalise to a real boolean. */
/** createdAt/updatedAt are unix seconds on SQLite and a Date on Postgres. */
function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  return Date.now();
}

function toBool(value: unknown): boolean {
  return value === true || value === 1;
}

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  bulletPoints: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  variantName: string | null;
  taxCode: string | null;
  isLive: unknown;
  stripeProductId: string | null;
  stripeTaxSignature: string | null;
}

interface VariantRow {
  id: string;
  productId: string;
  label: string;
  priceCents: number;
  inventoryType: string;
  inventoryQuantity: number;
  weightGrams: number;
  stripePriceId: string | null;
}

interface ProductOptionRow {
  id: string;
  productId: string;
  name: string;
}

interface ProductOptionValueRow {
  id: string;
  optionId: string;
  value: string;
}

interface VariantOptionValueRow {
  variantId: string;
  optionValueId: string;
}

interface ImageRow {
  productId: string;
  path: string;
  width: number;
  height: number;
  alt: string;
  widths: unknown;
}

interface OptionGroupRow {
  productId: string;
  name: string;
  choices: unknown;
}

/** One priced axis, hydrated with its ordered values. */
interface HydratedOption {
  id: string;
  name: string;
  values: string[];
}

function buildProduct(
  row: ProductRow,
  variants: VariantRow[],
  images: ImageRow[],
  groups: OptionGroupRow[],
  options: HydratedOption[],
  /** variantId -> selected value per axis, in the same order as `options`. */
  optionValuesByVariant: Map<string, string[]>,
): Product {
  return productSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    bulletPoints: parseJson<string[]>(row.bulletPoints, []),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    images: images.map((i) => ({
      path: i.path,
      width: i.width,
      height: i.height,
      alt: i.alt,
      widths: parseJson<number[]>(i.widths, []),
    })),
    variantName: row.variantName,
    variants: variants.map((v) => ({
      id: v.id,
      label: v.label,
      priceCents: v.priceCents,
      inventory:
        v.inventoryType === "finite"
          ? { type: "finite" as const, quantity: v.inventoryQuantity }
          : { type: "infinite" as const },
      weightGrams: v.weightGrams,
      stripePriceId: v.stripePriceId,
      optionValues: optionValuesByVariant.get(v.id) ?? [],
    })),
    options: options.map((o) => ({ id: o.id, name: o.name, values: o.values })),
    optionGroups: groups.map((g) => ({
      name: g.name,
      choices: parseJson<string[]>(g.choices, []),
    })),
    taxCode: row.taxCode,
    isLive: toBool(row.isLive),
    stripeProductId: row.stripeProductId,
    stripeTaxSignature: row.stripeTaxSignature,
  });
}

/** Attach variants, images, option groups and priced axes to product rows. */
async function hydrate(rows: ProductRow[]): Promise<Product[]> {
  if (rows.length === 0) return [];

  const { drizzle: db, schema } = await getDatabase();
  const ids = rows.map((r) => r.id);

  const [variantRows, imageRows, groupRows, optionRows] = await Promise.all([
    db
      .select()
      .from(schema.variants)
      .where(inArray(schema.variants.productId, ids))
      .orderBy(asc(schema.variants.position)) as unknown as Promise<VariantRow[]>,
    db
      .select()
      .from(schema.productImages)
      .where(inArray(schema.productImages.productId, ids))
      .orderBy(asc(schema.productImages.position)) as unknown as Promise<ImageRow[]>,
    db
      .select()
      .from(schema.optionGroups)
      .where(inArray(schema.optionGroups.productId, ids))
      .orderBy(asc(schema.optionGroups.position)) as unknown as Promise<OptionGroupRow[]>,
    db
      .select({
        id: schema.productOptions.id,
        productId: schema.productOptions.productId,
        name: schema.productOptions.name,
      })
      .from(schema.productOptions)
      .where(inArray(schema.productOptions.productId, ids))
      .orderBy(asc(schema.productOptions.position)) as unknown as Promise<ProductOptionRow[]>,
  ]);

  const optionIds = optionRows.map((o) => o.id);
  const variantIds = variantRows.map((v) => v.id);

  let valueRows: ProductOptionValueRow[] = [];
  let variantValueRows: VariantOptionValueRow[] = [];

  if (optionIds.length > 0 && variantIds.length > 0) {
    [valueRows, variantValueRows] = (await Promise.all([
      db
        .select({
          id: schema.productOptionValues.id,
          optionId: schema.productOptionValues.optionId,
          value: schema.productOptionValues.value,
        })
        .from(schema.productOptionValues)
        .where(inArray(schema.productOptionValues.optionId, optionIds))
        .orderBy(asc(schema.productOptionValues.position)),
      db
        .select()
        .from(schema.variantOptionValues)
        .where(inArray(schema.variantOptionValues.variantId, variantIds)),
    ])) as unknown as [ProductOptionValueRow[], VariantOptionValueRow[]];
  }

  const groupBy = <T extends { productId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of list) {
      const existing = map.get(item.productId);
      if (existing) existing.push(item);
      else map.set(item.productId, [item]);
    }
    return map;
  };

  const variantsBy = groupBy(variantRows);
  const imagesBy = groupBy(imageRows);
  const groupsBy = groupBy(groupRows);
  const optionsBy = groupBy(optionRows);

  const valuesByOption = new Map<string, ProductOptionValueRow[]>();
  for (const value of valueRows) {
    const list = valuesByOption.get(value.optionId);
    if (list) list.push(value);
    else valuesByOption.set(value.optionId, [value]);
  }

  // value id -> { optionId, text }, so a variant's linked values can be
  // matched back to the axis they belong to.
  const valueById = new Map(valueRows.map((v) => [v.id, v]));

  const linkedValueIdsByVariant = new Map<string, string[]>();
  for (const link of variantValueRows) {
    const list = linkedValueIdsByVariant.get(link.variantId);
    if (list) list.push(link.optionValueId);
    else linkedValueIdsByVariant.set(link.variantId, [link.optionValueId]);
  }

  return rows
    .map((row) => {
      const options: HydratedOption[] = (optionsBy.get(row.id) ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        values: (valuesByOption.get(o.id) ?? []).map((v) => v.value),
      }));

      const optionValuesByVariant = new Map<string, string[]>();
      if (options.length > 0) {
        for (const variant of variantsBy.get(row.id) ?? []) {
          const linkedIds = linkedValueIdsByVariant.get(variant.id) ?? [];
          const linked = linkedIds
            .map((id) => valueById.get(id))
            .filter((v): v is ProductOptionValueRow => v !== undefined);

          optionValuesByVariant.set(
            variant.id,
            options.map((option) => linked.find((v) => v.optionId === option.id)?.value ?? ""),
          );
        }
      }

      return buildProduct(
        row,
        variantsBy.get(row.id) ?? [],
        imagesBy.get(row.id) ?? [],
        groupsBy.get(row.id) ?? [],
        options,
        optionValuesByVariant,
      );
    })
    // A product with no variant has no price, so it cannot be sold or rendered.
    .filter((p) => p.variants.length > 0);
}

export interface ListProductsOptions {
  /** Storefront callers pass true; the admin lists drafts too. */
  liveOnly?: boolean;
  collectionSlug?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ProductPage {
  products: Product[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Paginated product listing.
 *
 * v1 held the whole catalogue in one JSON file and shipped all of it to every
 * visitor, which is the constraint this replaces.
 */
export async function listProducts(options: ListProductsOptions = {}): Promise<ProductPage> {
  const { drizzle: db, schema } = await getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters = [];
  if (options.liveOnly) filters.push(eq(schema.products.isLive, true));
  if (options.search) {
    const term = `%${options.search.toLowerCase()}%`;
    filters.push(
      or(
        like(sql`lower(${schema.products.name})`, term),
        like(sql`lower(${schema.products.description})`, term),
      ),
    );
  }

  if (options.collectionSlug) {
    const collection = await findCollectionBySlug(options.collectionSlug);
    if (!collection) return { products: [], total: 0, limit, offset };

    const links = (await db
      .select({ productId: schema.collectionProducts.productId })
      .from(schema.collectionProducts)
      .where(eq(schema.collectionProducts.collectionId, collection.id))
      .orderBy(asc(schema.collectionProducts.position))) as unknown as { productId: string }[];

    const orderedIds = links.map((l) => l.productId);
    if (orderedIds.length === 0) return { products: [], total: 0, limit, offset };

    filters.push(inArray(schema.products.id, orderedIds));

    const rows = (await db
      .select()
      .from(schema.products)
      .where(and(...filters))) as unknown as ProductRow[];

    // Preserve the collection's curated order, which a SQL sort would lose.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = orderedIds.map((id) => byId.get(id)).filter((r): r is ProductRow => !!r);

    return {
      products: await hydrate(ordered.slice(offset, offset + limit)),
      total: ordered.length,
      limit,
      offset,
    };
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(schema.products)
      .where(where)
      .orderBy(asc(schema.products.position), asc(schema.products.name))
      .limit(limit)
      .offset(offset) as unknown as Promise<ProductRow[]>,
    db.select({ value: count() }).from(schema.products).where(where) as unknown as Promise<
      { value: number }[]
    >,
  ]);

  return {
    products: await hydrate(rows),
    total: totals[0]?.value ?? 0,
    limit,
    offset,
  };
}

export async function findProductBySlug(slug: string, liveOnly = true): Promise<Product | null> {
  const { drizzle: db, schema } = await getDatabase();

  const filters = [eq(schema.products.slug, slug)];
  if (liveOnly) filters.push(eq(schema.products.isLive, true));

  const rows = (await db
    .select()
    .from(schema.products)
    .where(and(...filters))
    .limit(1)) as unknown as ProductRow[];

  const hydrated = await hydrate(rows);
  return hydrated[0] ?? null;
}

export async function listCollections(): Promise<Collection[]> {
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
    collectionSchema.parse({
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
      productIds: links.filter((l) => l.collectionId === row.id).map((l) => l.productId),
    }),
  );
}

export async function findCollectionBySlug(slug: string): Promise<Collection | null> {
  const all = await listCollections();
  return all.find((c) => c.slug === slug) ?? null;
}

interface SettingsRow {
  name: string;
  currency: string;
  stripePublishableKey: string | null;
  aboutText: string | null;
  taxEnabled: unknown;
  taxBehavior: string;
  defaultTaxCode: string;
  themeColorPrimary: string;
  themeColorAccent: string;
  themeFontFamily: string;
  themeBorderRadius: number;
}

export async function getSettings(): Promise<{
  name: string;
  currency: string;
  stripePublishableKey: string | null;
  aboutText: string | null;
  taxEnabled: boolean;
  taxBehavior: TaxBehavior;
  defaultTaxCode: string;
  theme: Theme;
} | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db.select().from(schema.storeSettings).limit(1)) as unknown as SettingsRow[];
  const row = rows[0];
  if (!row) return null;

  return {
    name: row.name,
    currency: row.currency,
    stripePublishableKey: row.stripePublishableKey,
    aboutText: row.aboutText,
    taxEnabled: toBool(row.taxEnabled),
    // Parsed rather than cast: a column edited by hand should not silently
    // become a third tax behaviour that Stripe has never heard of.
    taxBehavior: taxBehaviorSchema.catch("exclusive").parse(row.taxBehavior),
    defaultTaxCode: row.defaultTaxCode,
    theme: themeSchema.parse({
      colorPrimary: row.themeColorPrimary,
      colorAccent: row.themeColorAccent,
      fontFamily: row.themeFontFamily,
      borderRadius: row.themeBorderRadius,
    }),
  };
}

/**
 * The whole store in one object, for the storefront's initial render.
 *
 * Capped at STORE_SNAPSHOT_LIMIT products. Larger catalogues are served by
 * `listProducts`, which the storefront grid moves to in Phase 4.
 */
export async function getStoreSnapshot(): Promise<Store | null> {
  const settings = await getSettings();
  if (!settings) return null;

  const [{ products }, collections, pages] = await Promise.all([
    listProducts({ liveOnly: true, limit: STORE_SNAPSHOT_LIMIT }),
    listCollections(),
    // Summaries only: the banner needs titles on first paint, and bodies are
    // fetched a page at a time from /api/pages/:slug.
    listPageSummaries({ liveOnly: true }),
  ]);

  const { zones } = await getShippingTable();

  return storeSchema.parse({
    name: settings.name,
    // Publishable key only. The secret key never leaves the environment.
    stripePublishableKey: settings.stripePublishableKey,
    currency: settings.currency,
    theme: settings.theme,
    aboutText: settings.aboutText,
    taxBehavior: settings.taxBehavior,
    collections,
    pages,
    products,
    shipping: {
      countries: countriesCovered(zones),
      worldwide: hasCatchAllZone(zones),
    },
  });
}

/** True once the setup wizard has written settings and an admin user. */
export async function isConfigured(): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const [settings, admins] = await Promise.all([
    db.select({ value: count() }).from(schema.storeSettings) as unknown as Promise<{ value: number }[]>,
    db.select({ value: count() }).from(schema.adminUsers) as unknown as Promise<{ value: number }[]>,
  ]);

  return (settings[0]?.value ?? 0) > 0 && (admins[0]?.value ?? 0) > 0;
}

export interface SitemapEntry {
  path: string;
  lastModified: number;
}

/**
 * Slugs and modification times for the sitemap.
 *
 * A dedicated query rather than `listProducts`, because the sitemap needs
 * `updatedAt` — which is not on the `Product` schema and does not belong there
 * for the sake of one consumer — and needs no variants, images or option
 * groups at all.
 */
export async function listSitemapEntries(): Promise<SitemapEntry[]> {
  const { drizzle: db, schema } = await getDatabase();

  const [products, collections] = await Promise.all([
    db
      .select({ slug: schema.products.slug, updatedAt: schema.products.updatedAt })
      .from(schema.products)
      .where(eq(schema.products.isLive, true))
      .orderBy(asc(schema.products.position)) as unknown as Promise<
      { slug: string; updatedAt: unknown }[]
    >,
    db
      .select({ slug: schema.collections.slug, updatedAt: schema.collections.updatedAt })
      .from(schema.collections)
      .orderBy(asc(schema.collections.position)) as unknown as Promise<
      { slug: string; updatedAt: unknown }[]
    >,
  ]);

  return [
    ...collections.map((row) => ({
      path: `/collection/${row.slug}`,
      lastModified: toEpochMs(row.updatedAt),
    })),
    ...products.map((row) => ({
      path: `/product/${row.slug}`,
      lastModified: toEpochMs(row.updatedAt),
    })),
  ];
}
