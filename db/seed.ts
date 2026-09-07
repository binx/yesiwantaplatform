import { randomUUID } from "node:crypto";
import { demoStore } from "../shared/demo-store.js";
import type { Store } from "../shared/schema.js";
import { getDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";
import { createAdmin, countAdmins } from "../server/auth.js";

/**
 * Populate an empty database so a clone has something to look at.
 *
 * v1 shipped `store_config.json` as `{}`, so a fresh install rendered nothing
 * until the owner had created products by hand.
 */

/** SQLite stores JSON in TEXT; Postgres jsonb takes the value as-is. */
function jsonFor(isPg: boolean, value: unknown): unknown {
  return isPg ? value : JSON.stringify(value);
}

export async function seedStore(store: Store = demoStore): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const json = (value: unknown) => jsonFor(dialect === "pg", value);

  await db.insert(schema.storeSettings).values({
    id: 1,
    name: store.name,
    currency: store.currency,
    stripePublishableKey: store.stripePublishableKey,
    aboutText: store.aboutText,
    themeColorPrimary: store.theme.colorPrimary,
    themeColorAccent: store.theme.colorAccent,
    themeFontFamily: store.theme.fontFamily,
    themeBorderRadius: store.theme.borderRadius,
  });

  for (const [index, product] of store.products.entries()) {
    await db.insert(schema.products).values({
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      bulletPoints: json(product.bulletPoints),
      variantName: product.variantName,
      isLive: product.isLive,
      stripeProductId: product.stripeProductId,
      position: index,
    });

    for (const [vIndex, variant] of product.variants.entries()) {
      await db.insert(schema.variants).values({
        id: variant.id,
        productId: product.id,
        label: variant.label,
        priceCents: variant.priceCents,
        inventoryType: variant.inventory.type,
        inventoryQuantity: variant.inventory.type === "finite" ? variant.inventory.quantity : 0,
        weightGrams: variant.weightGrams,
        stripePriceId: variant.stripePriceId,
        position: vIndex,
      });
    }

    for (const [iIndex, image] of product.images.entries()) {
      await db.insert(schema.productImages).values({
        id: randomUUID(),
        productId: product.id,
        path: image.path,
        width: image.width,
        height: image.height,
        alt: image.alt,
        widths: json(image.widths),
        position: iIndex,
      });
    }

    for (const [gIndex, group] of product.optionGroups.entries()) {
      await db.insert(schema.optionGroups).values({
        id: randomUUID(),
        productId: product.id,
        name: group.name,
        choices: json(group.choices),
        position: gIndex,
      });
    }
  }

  for (const [index, collection] of store.collections.entries()) {
    await db.insert(schema.collections).values({
      id: collection.id,
      slug: collection.slug,
      name: collection.name,
      coverPath: collection.cover?.path ?? null,
      coverWidth: collection.cover?.width ?? null,
      coverHeight: collection.cover?.height ?? null,
      coverAlt: collection.cover?.alt ?? null,
      position: index,
    });

    for (const [pIndex, productId] of collection.productIds.entries()) {
      await db.insert(schema.collectionProducts).values({
        collectionId: collection.id,
        productId,
        position: pIndex,
      });
    }
  }
}

/** Seed only an untouched database, so re-running is harmless. */
export async function seedIfEmpty(store: Store = demoStore): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const existing = (await db.select().from(schema.storeSettings).limit(1)) as unknown[];
  if (existing.length > 0) return false;

  await seedStore(store);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    try {
      await runMigrations();

      const seeded = await seedIfEmpty();
      console.log(seeded ? "Demo store seeded." : "Store already has settings; nothing to do.");

      if ((await countAdmins()) === 0) {
        const password = process.env.ADMIN_PASSWORD;
        const email = process.env.ADMIN_EMAIL ?? "admin@example.com";

        if (password) {
          await createAdmin(email, password);
          console.log(`Admin created: ${email}`);
        } else {
          console.log(
            "No admin user yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, or use the setup wizard.",
          );
        }
      }

      process.exit(0);
    } catch (error) {
      console.error("Seed failed:", error);
      process.exit(1);
    }
  })();
}
