import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { defaultHero, defaultTheme, type Product } from "../shared/schema.js";
import { settingsInputSchema } from "../shared/api.js";

/**
 * Tax, where it reaches Stripe.
 *
 * Two of these assertions are load-bearing rather than descriptive:
 *
 *   - A store that collects no tax must publish exactly what it published
 *     before this feature existed. Sending `tax_behavior: "unspecified"` where
 *     nothing used to be sent would churn every Price in every account.
 *   - `tax_behavior` is immutable on a Stripe Price. A store that switches
 *     from exclusive to inclusive therefore has to mint new Prices; an update
 *     call would be rejected, and skipping the comparison would leave every
 *     published Price quietly carrying the old behaviour.
 */

let stripe: Stripe;
let sync: (product: Product) => Promise<unknown>;

let productsCreate: ReturnType<typeof vi.fn>;
let productsUpdate: ReturnType<typeof vi.fn>;
let pricesCreate: ReturnType<typeof vi.fn>;
let pricesUpdate: ReturnType<typeof vi.fn>;
let pricesRetrieve: ReturnType<typeof vi.fn>;

/** The Price Stripe will claim to already have, or null for "none yet". */
let existingPrice: Partial<Stripe.Price> | null = null;

async function setTax(options: {
  enabled: boolean;
  behavior?: "exclusive" | "inclusive";
  defaultTaxCode?: string;
}) {
  const { getDatabase } = await import("../db/client.js");
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.storeSettings)
    .set({
      taxEnabled: options.enabled,
      taxBehavior: options.behavior ?? "exclusive",
      defaultTaxCode: options.defaultTaxCode ?? "txcd_99999999",
    })
    .where(eq(schema.storeSettings.id, 1));
}

async function loadProduct(slug: string): Promise<Product> {
  const { findProductBySlug } = await import("../db/repository.js");
  const product = await findProductBySlug(slug, false);
  if (!product) throw new Error(`No product "${slug}" in the seed.`);
  return product;
}

async function taxSignatureOf(productId: string): Promise<string | null> {
  const { getDatabase } = await import("../db/client.js");
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ signature: schema.products.stripeTaxSignature })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1)) as unknown as { signature: string | null }[];

  return rows[0]?.signature ?? null;
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { requireStripe } = await import("./stripe.js");
  const { syncProductToStripe } = await import("./catalog-sync.js");

  await runMigrations();
  await seedIfEmpty();

  stripe = requireStripe();
  sync = syncProductToStripe;
});

beforeEach(() => {
  existingPrice = null;

  productsCreate = vi.fn().mockImplementation(() => ({ id: "prod_test_123" }));
  productsUpdate = vi.fn().mockImplementation(() => ({ id: "prod_test_123" }));
  pricesCreate = vi
    .fn()
    .mockImplementation(() => ({ id: `price_test_${Math.random().toString(36).slice(2)}` }));
  pricesUpdate = vi.fn().mockImplementation(() => ({ id: "price_old" }));
  pricesRetrieve = vi.fn().mockImplementation(() => {
    if (!existingPrice) throw new Error("No such price");
    return existingPrice;
  });

  vi.spyOn(stripe.products, "create").mockImplementation(
    productsCreate as unknown as typeof stripe.products.create,
  );
  vi.spyOn(stripe.products, "update").mockImplementation(
    productsUpdate as unknown as typeof stripe.products.update,
  );
  vi.spyOn(stripe.prices, "create").mockImplementation(
    pricesCreate as unknown as typeof stripe.prices.create,
  );
  vi.spyOn(stripe.prices, "update").mockImplementation(
    pricesUpdate as unknown as typeof stripe.prices.update,
  );
  vi.spyOn(stripe.prices, "retrieve").mockImplementation(
    pricesRetrieve as unknown as typeof stripe.prices.retrieve,
  );
});

describe("publishing with tax off", () => {
  it("sends neither a tax code nor a tax behaviour", async () => {
    await setTax({ enabled: false });
    await sync(await loadProduct("canvas-tote"));

    const productParams = (productsCreate.mock.calls[0]?.[0] ??
      productsUpdate.mock.calls[0]?.[1]) as Stripe.ProductCreateParams;
    expect(productParams.tax_code).toBeUndefined();

    const priceParams = pricesCreate.mock.calls[0]?.[0] as Stripe.PriceCreateParams;
    expect(priceParams.tax_behavior).toBeUndefined();
  });

  it("records no tax signature, so nothing is reported as out of date", async () => {
    await setTax({ enabled: false });
    const product = await loadProduct("canvas-tote");
    await sync(product);

    expect(await taxSignatureOf(product.id)).toBeNull();
  });
});

describe("publishing with tax on", () => {
  it("sends the store's default code and behaviour", async () => {
    await setTax({ enabled: true, behavior: "inclusive", defaultTaxCode: "txcd_20030000" });
    const product = await loadProduct("canvas-tote");
    await sync(product);

    const productParams = (productsCreate.mock.calls[0]?.[0] ??
      productsUpdate.mock.calls[0]?.[1]) as Stripe.ProductCreateParams;
    expect(productParams.tax_code).toBe("txcd_20030000");

    const priceParams = pricesCreate.mock.calls[0]?.[0] as Stripe.PriceCreateParams;
    expect(priceParams.tax_behavior).toBe("inclusive");

    expect(await taxSignatureOf(product.id)).toBe("txcd_20030000|inclusive");
  });

  it("prefers a product's own tax code over the store default", async () => {
    await setTax({ enabled: true, defaultTaxCode: "txcd_99999999" });

    const { getDatabase } = await import("../db/client.js");
    const { drizzle: db, schema } = await getDatabase();
    const product = await loadProduct("risograph-print");

    await db
      .update(schema.products)
      .set({ taxCode: "txcd_10302000" })
      .where(eq(schema.products.id, product.id));

    await sync(await loadProduct("risograph-print"));

    const productParams = (productsCreate.mock.calls[0]?.[0] ??
      productsUpdate.mock.calls[0]?.[1]) as Stripe.ProductCreateParams;
    expect(productParams.tax_code).toBe("txcd_10302000");
    expect(await taxSignatureOf(product.id)).toBe("txcd_10302000|exclusive");

    await db
      .update(schema.products)
      .set({ taxCode: null })
      .where(eq(schema.products.id, product.id));
  });
});

describe("changing the tax behaviour", () => {
  it("mints a new Price and archives the old one rather than updating", async () => {
    await setTax({ enabled: true, behavior: "exclusive" });
    const product = await loadProduct("enamel-mug");
    const variant = product.variants[0]!;

    // Stripe already holds a Price at the right amount, but with the old
    // behaviour — which is exactly the state a merchant is in after switching.
    existingPrice = {
      id: "price_old",
      active: true,
      unit_amount: variant.priceCents,
      currency: "usd",
      tax_behavior: "exclusive",
    };

    const alreadyPublished = {
      ...product,
      stripeProductId: "prod_test_123",
      variants: product.variants.map((v) => ({ ...v, stripePriceId: "price_old" })),
    };

    await sync(alreadyPublished);
    // Nothing to do: everything immutable about the Price still matches.
    expect(pricesCreate).not.toHaveBeenCalled();

    await setTax({ enabled: true, behavior: "inclusive" });
    await sync(alreadyPublished);

    expect(pricesUpdate).toHaveBeenCalledWith("price_old", { active: false });
    expect(pricesCreate).toHaveBeenCalledTimes(1);
    expect(
      (pricesCreate.mock.calls[0]?.[0] as Stripe.PriceCreateParams).tax_behavior,
    ).toBe("inclusive");

    // Never an update: Stripe rejects a change to tax_behavior on a Price, so
    // an attempt would be an error rather than a no-op.
    expect(pricesUpdate).not.toHaveBeenCalledWith("price_old", expect.objectContaining({
      tax_behavior: "inclusive",
    }));
  });
});

describe("what the admin is told", () => {
  it("names published products that predate the current tax settings", async () => {
    const { listAllProductsForAdmin } = await import("../db/admin-repository.js");

    await setTax({ enabled: true, behavior: "exclusive", defaultTaxCode: "txcd_99999999" });
    const product = await loadProduct("canvas-tote");
    await sync({ ...product, stripeProductId: "prod_test_123" });

    const published = (await listAllProductsForAdmin()).find((p) => p.id === product.id);
    expect(published?.needsTaxRepublish).toBe(false);

    // The merchant switches how prices are quoted. Nothing republishes itself.
    await setTax({ enabled: true, behavior: "inclusive" });

    const stale = (await listAllProductsForAdmin()).find((p) => p.id === product.id);
    expect(stale?.needsTaxRepublish).toBe(true);
  });

  it("reports nothing as out of date while tax is off", async () => {
    await setTax({ enabled: false });

    const rows = await import("../db/admin-repository.js").then((m) =>
      m.listAllProductsForAdmin(),
    );

    expect(rows.every((row) => !row.needsTaxRepublish)).toBe(true);
  });
});

describe("the settings round-trip", () => {
  it("stores and returns the three tax fields", async () => {
    const { updateSettings } = await import("../db/admin-repository.js");
    const { getSettings } = await import("../db/repository.js");

    await updateSettings({
      name: "Tax Test Store",
      currency: "EUR",
      stripePublishableKey: null,
      aboutText: null,
      taxEnabled: true,
      taxBehavior: "inclusive",
      defaultTaxCode: "txcd_20030000",
      cartRecoveryEnabled: false,
      cartRecoveryDelayHours: 4,
      hero: defaultHero,
    theme: defaultTheme,
    });

    const settings = await getSettings();
    expect(settings?.taxEnabled).toBe(true);
    expect(settings?.taxBehavior).toBe("inclusive");
    expect(settings?.defaultTaxCode).toBe("txcd_20030000");

    // And the storefront learns how prices are quoted, so it can say
    // "includes tax" rather than showing an additive-looking row.
    const { getStoreSnapshot } = await import("../db/repository.js");
    expect((await getStoreSnapshot())?.taxBehavior).toBe("inclusive");
  });

  it("refuses a tax code that is not one", () => {
    const result = settingsInputSchema.safeParse({
      name: "Store",
      currency: "USD",
      stripePublishableKey: null,
      aboutText: null,
      taxEnabled: true,
      taxBehavior: "exclusive",
      defaultTaxCode: "99999999",
      hero: defaultHero,
    theme: defaultTheme,
    });

    expect(result.success).toBe(false);
  });
});
