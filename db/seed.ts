import { demoStore } from "../shared/demo-store.js";
import type { Store } from "../shared/schema.js";
import { getDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";
import { createAdmin, countAdmins } from "../server/auth.js";

/**
 * Populate an empty database so a clone has a platform to look at.
 *
 * There is no catalogue to seed — artists make their own pages — so this is
 * the settings row and nothing else. The tests lean on it for a platform
 * that exists; `npm run db:seed` uses it for a first run without the wizard.
 */
export async function seedStore(store: Store = demoStore): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db.insert(schema.storeSettings).values({
    id: 1,
    name: store.name,
    currency: store.currency,
    locale: store.locale,
    stripePublishableKey: store.stripePublishableKey,
    printCostCents: store.pricing.printCostCents,
    platformFeeCents: store.pricing.platformFeeCents,
    minMonthlyPriceCents: store.pricing.minMonthlyPriceCents,
    themeColorPrimary: store.theme.colorPrimary,
    themeColorAccent: store.theme.colorAccent,
    themeFontFamily: store.theme.fontFamily,
    themeFontUrl: store.theme.fontUrl,
    themeBorderRadius: store.theme.borderRadius,
    themeColorScheme: store.theme.colorScheme,
    themeColorPage: store.theme.colorPage,
    heroHeading: store.hero.heading,
    heroText: store.hero.text,
    heroButtonLabel: store.hero.buttonLabel,
    heroButtonHref: store.hero.buttonHref,
    heroImagePath: store.hero.image?.path ?? null,
    heroImageWidth: store.hero.image?.width ?? null,
    heroImageHeight: store.hero.image?.height ?? null,
    heroImageAlt: store.hero.image?.alt ?? null,
  });
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
      console.log(seeded ? "Platform settings seeded." : "Platform already has settings; nothing to do.");

      if ((await countAdmins()) === 0) {
        const password = process.env.ADMIN_PASSWORD;
        const email = process.env.ADMIN_EMAIL ?? "admin@example.com";

        if (password) {
          await createAdmin(email, password);
          console.log(`Admin created: ${email}`);
        } else {
          console.log("No admin user yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, or use the setup wizard.");
        }
      }

      process.exit(0);
    } catch (error) {
      console.error("Seed failed:", error);
      process.exit(1);
    }
  })();
}
