import { eq } from "drizzle-orm";
import type { SettingsInput } from "../shared/api.js";
import { getDatabase } from "./client.js";
import { jsonFor } from "./repository.js";

/**
 * Admin writes.
 *
 * Every function here is reachable only behind `requireAdmin` and a CSRF
 * check. What is left to write from the admin is the settings row; artists
 * write their own rows through the studio.
 */

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`The address "${slug}" is already in use.`);
    this.name = "SlugTakenError";
  }
}

/** "" and "   " both mean "no value", so both become the column's null. */
function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function updateSettings(input: SettingsInput): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const values = {
    name: input.name,
    currency: input.currency,
    locale: input.locale,
    stripePublishableKey: input.stripePublishableKey,
    printCostCents: input.pricing.printCostCents,
    platformFeeCents: input.pricing.platformFeeCents,
    minMonthlyPriceCents: input.pricing.minMonthlyPriceCents,
    returnAddress: input.returnAddress ? jsonFor(dialect, input.returnAddress) : null,
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
    // Empty is not a value here: an operator clearing the heading means "go
    // back to the built-in one", and storing "" would render an empty <h1>.
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
