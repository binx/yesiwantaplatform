import { count } from "drizzle-orm";
import {
  storeSchema,
  colorSchemeSchema,
  themeSchema,
  heroHrefSchema,
  fontUrlSchema,
  localeSchema,
  type Hero,
  type Store,
  type Theme,
} from "../shared/schema.js";
import { recipientSchema, type Recipient } from "../shared/postcards.js";
import { getDatabase } from "./client.js";
import { listPageSummaries } from "./pages-repository.js";

/**
 * Store settings and the snapshot the storefront boots from.
 *
 * Every value that leaves this module is parsed with the shared zod schemas,
 * so a mapping mistake surfaces as a validation error rather than as bad data
 * on the storefront.
 */

/** createdAt/updatedAt are unix seconds on SQLite and a Date on Postgres. */
export function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  return Date.now();
}

export function toBool(value: unknown): boolean {
  return value === true || value === 1;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  // Postgres jsonb arrives decoded; SQLite stores JSON in TEXT.
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** SQLite stores JSON in TEXT; Postgres jsonb takes the value as-is. */
export function jsonFor(dialect: string, value: unknown): unknown {
  return dialect === "pg" ? value : JSON.stringify(value);
}

/** Postgres wants a Date for timestamptz; SQLite stores a unix integer. */
export function nowFor(dialect: string): Date | number {
  return dialect === "pg" ? new Date() : Math.floor(Date.now() / 1000);
}

interface SettingsRow {
  name: string;
  currency: string;
  locale: string;
  stripePublishableKey: string | null;
  postcardPriceCents: number;
  internationalPostcardPriceCents: number | null;
  returnAddress: unknown;
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

export interface Settings {
  name: string;
  currency: string;
  locale: string;
  stripePublishableKey: string | null;
  postcardPriceCents: number;
  internationalPostcardPriceCents: number | null;
  /** Null until the merchant sets one; international checkout refuses without it. */
  returnAddress: Recipient | null;
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayHours: number;
  theme: Theme;
  hero: Hero;
}

export async function getSettings(): Promise<Settings | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db.select().from(schema.storeSettings).limit(1)) as unknown as SettingsRow[];
  const row = rows[0];
  if (!row) return null;

  return {
    name: row.name,
    currency: row.currency,
    // Parsed with a fallback: a tag typed straight into the column by hand
    // would otherwise throw inside every `Intl` constructor downstream.
    locale: localeSchema.catch("en-US").parse(row.locale),
    stripePublishableKey: row.stripePublishableKey,
    postcardPriceCents: row.postcardPriceCents,
    internationalPostcardPriceCents: row.internationalPostcardPriceCents,
    // Parsed with a fallback: a hand-edited row that no longer passes reads
    // as "no return address", which is the safe answer.
    returnAddress: recipientSchema.nullable().catch(null).parse(parseJson(row.returnAddress, null)),
    cartRecoveryEnabled: toBool(row.cartRecoveryEnabled),
    cartRecoveryDelayHours: row.cartRecoveryDelayHours,
    theme: themeSchema.parse({
      colorPrimary: row.themeColorPrimary,
      colorAccent: row.themeColorAccent,
      fontFamily: row.themeFontFamily,
      // Dropped rather than rendered if it no longer passes: the value goes
      // into a <link href> on every page and widens the CSP by its origin.
      fontUrl: fontUrlSchema.nullable().catch(null).parse(row.themeFontUrl),
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
    hero: {
      heading: row.heroHeading,
      text: row.heroText,
      buttonLabel: row.heroButtonLabel,
      // Parsed, not cast: this is the one field that ends up in an `href`.
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

/** The whole store in one object, for the storefront's initial render. */
export async function getStoreSnapshot(): Promise<Store | null> {
  const settings = await getSettings();
  if (!settings) return null;

  // Summaries only: the banner needs titles on first paint, and bodies are
  // fetched a page at a time from /api/pages/:slug.
  const pages = await listPageSummaries({ liveOnly: true });

  return storeSchema.parse({
    name: settings.name,
    // Publishable key only. The secret key never leaves the environment.
    stripePublishableKey: settings.stripePublishableKey,
    currency: settings.currency,
    locale: settings.locale,
    postcardPriceCents: settings.postcardPriceCents,
    internationalPostcardPriceCents: settings.internationalPostcardPriceCents,
    theme: settings.theme,
    hero: settings.hero,
    pages,
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
