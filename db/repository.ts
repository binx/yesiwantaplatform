import { and, asc, count, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  collectionSchema,
  productKindSchema,
  productSchema,
  storeSchema,
  colorSchemeSchema,
  taxBehaviorSchema,
  themeSchema,
  heroHrefSchema,
  fontUrlSchema,
  localeSchema,
  type Collection,
  type Hero,
  type Product,
  type Store,
  type TaxBehavior,
  type Theme,
} from "../shared/schema.js";
import { countriesCovered, hasCatchAllZone } from "../shared/shipping.js";
import { renderMarkdown } from "../server/markdown.js";
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
  kind: string;
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
    // Parsed rather than cast: a row written before this column existed, or by
    // hand, must not put an unknown kind into shipping's physical/digital fork.
    kind: productKindSchema.catch("physical").parse(row.kind),
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

/**
 * Look several products up at once, drafts included.
 *
 * One query rather than a `findProductBySlug` per slug: the catalogue importer
 * needs to know which of a few hundred slugs already exist before it writes
 * anything, and doing that one round trip at a time is what makes a large
 * import feel broken.
 */
export async function findProductsBySlugs(slugs: string[]): Promise<Product[]> {
  if (slugs.length === 0) return [];

  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.products)
    .where(inArray(schema.products.slug, slugs))) as unknown as ProductRow[];

  return hydrate(rows);
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
      /*
       * Rendered here rather than in each route, so `/api/store` and
       * `/api/collections` cannot come to disagree about what a collection
       * says. Rendered on the way *out*, never on the way in — the column
       * holds Markdown, so tightening the allow-list in server/markdown.ts
       * applies retroactively to every collection already written.
       */
      descriptionHtml: row.description ? renderMarkdown(row.description) : "",
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
  locale: string;
  stripePublishableKey: string | null;
  aboutText: string | null;
  taxEnabled: unknown;
  taxBehavior: string;
  defaultTaxCode: string;
  cartRecoveryEnabled: unknown;
  cartRecoveryDelayHours: number;
  themeColorPrimary: string;
  themeColorAccent: string;
  themeFontFamily: string;
  themeFontUrl: string | null;
  themeBorderRadius: number;
  themeColorScheme: string;
  themeColorPage: string | null;
  themeLogoPath: string | null;
  themeLogoWidth: number | null;
  themeLogoHeight: number | null;
  themeLogoAlt: string | null;
  heroHeading: string | null;
  heroText: string | null;
  heroButtonLabel: string | null;
  heroButtonHref: string | null;
  heroImagePath: string | null;
  heroImageWidth: number | null;
  heroImageHeight: number | null;
  heroImageAlt: string | null;
}

export async function getSettings(): Promise<{
  name: string;
  currency: string;
  locale: string;
  stripePublishableKey: string | null;
  aboutText: string | null;
  taxEnabled: boolean;
  taxBehavior: TaxBehavior;
  defaultTaxCode: string;
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayHours: number;
  theme: Theme;
  hero: Hero;
} | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db.select().from(schema.storeSettings).limit(1)) as unknown as SettingsRow[];
  const row = rows[0];
  if (!row) return null;

  return {
    name: row.name,
    currency: row.currency,
    // Parsed with a fallback for the same reason the theme is: a tag typed
    // straight into the column by hand would otherwise throw inside every
    // `Intl` constructor downstream and take the storefront with it.
    locale: localeSchema.catch("en-US").parse(row.locale),
    stripePublishableKey: row.stripePublishableKey,
    aboutText: row.aboutText,
    taxEnabled: toBool(row.taxEnabled),
    // Parsed rather than cast: a column edited by hand should not silently
    // become a third tax behaviour that Stripe has never heard of.
    taxBehavior: taxBehaviorSchema.catch("exclusive").parse(row.taxBehavior),
    defaultTaxCode: row.defaultTaxCode,
    cartRecoveryEnabled: toBool(row.cartRecoveryEnabled),
    cartRecoveryDelayHours: row.cartRecoveryDelayHours,
    theme: themeSchema.parse({
      colorPrimary: row.themeColorPrimary,
      colorAccent: row.themeColorAccent,
      fontFamily: row.themeFontFamily,
      // Dropped rather than rendered if it no longer passes: the value goes
      // into a <link href> on every page and widens the CSP by its origin, so
      // a row written before `fontUrlSchema` tightened must not be trusted.
      fontUrl: fontUrlSchema.nullable().catch(null).parse(row.themeFontUrl),
      // Clamped, not parsed strictly: the cap used to be 24, so rows written
      // before it dropped to 4 are still out there. A stale cosmetic value must
      // not 500 the storefront.
      borderRadius: Math.min(row.themeBorderRadius, 4),
      colorScheme: colorSchemeSchema.catch("light").parse(row.themeColorScheme),
      colorPage: row.themeColorPage,
      logo:
        row.themeLogoPath && row.themeLogoWidth && row.themeLogoHeight
          ? {
              path: row.themeLogoPath,
              width: row.themeLogoWidth,
              height: row.themeLogoHeight,
              alt: row.themeLogoAlt ?? "",
            }
          : null,
    }),
    /*
     * Parsed, not cast, for the same reason the theme is: `heroButtonHref` is
     * the one field here that ends up in an `href`, and a row edited by hand —
     * or written before `heroHrefSchema` tightened — must not put
     * `javascript:` in front of a shopper. A value that no longer passes is
     * dropped back to the default rather than rendered.
     */
    hero: {
      heading: row.heroHeading,
      text: row.heroText,
      buttonLabel: row.heroButtonLabel,
      buttonHref: heroHrefSchema.nullable().catch(null).parse(row.heroButtonHref),
      image:
        row.heroImagePath && row.heroImageWidth && row.heroImageHeight
          ? {
              path: row.heroImagePath,
              width: row.heroImageWidth,
              height: row.heroImageHeight,
              alt: row.heroImageAlt ?? "",
              widths: [],
            }
          : null,
    },
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
    locale: settings.locale,
    theme: settings.theme,
    hero: settings.hero,
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

export interface StorefrontState {
  access: "public" | "password";
  passwordHash: string | null;
  shareTokenHash: string | null;
  accessVersion: number;
  /** The whole row's own timestamp — see the note on `shareLinkCreatedAt`. */
  updatedAt: number;
}

/**
 * Who may view the storefront right now, and what proves it.
 *
 * A narrow select rather than `getSettings()`: this runs on the gate
 * middleware for every storefront request, and there is no reason to hydrate
 * the theme and the hero block just to read four columns. `null` means no
 * settings row exists yet, which the gate treats as public — a store that has
 * not been set up has nothing to protect.
 */
export async function getStorefrontState(): Promise<StorefrontState | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      access: schema.storeSettings.storefrontAccess,
      passwordHash: schema.storeSettings.storefrontPasswordHash,
      shareTokenHash: schema.storeSettings.storefrontShareToken,
      accessVersion: schema.storeSettings.storefrontAccessVersion,
      updatedAt: schema.storeSettings.updatedAt,
    })
    .from(schema.storeSettings)
    .limit(1)) as unknown as {
    access: string;
    passwordHash: string | null;
    shareTokenHash: string | null;
    accessVersion: number;
    updatedAt: unknown;
  }[];

  const row = rows[0];
  if (!row) return null;

  return {
    // Cast rather than parsed with a schema: an unrecognised value must fail
    // closed to "password", never to "public" — the opposite of every other
    // `.catch()` fallback in this file, because this one guards a security
    // gate rather than a cosmetic default.
    access: row.access === "public" ? "public" : "password",
    passwordHash: row.passwordHash,
    shareTokenHash: row.shareTokenHash,
    accessVersion: row.accessVersion,
    updatedAt: toEpochMs(row.updatedAt),
  };
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
