/**
 * Locale details both sides of the wire have to agree on.
 *
 * Small enough to look unnecessary, and it is not: the `<link>` that loads the
 * theme font is written twice — once by the production HTML handler before
 * React exists, once by `ThemeVars` when the store config lands — and the two
 * have to agree on how to find each other's element, or a page ends up with two
 * of them fetching the same stylesheet. Likewise `<html lang>`, which the
 * server writes into the shell and the client corrects after navigation.
 */

/** The id on the theme's font `<link>`. Written by the server, adopted by the client. */
export const FONT_LINK_ID = "beluga-font";

/**
 * The language subtag of a BCP 47 tag: `de-DE` → `de`.
 *
 * `<html lang>` wants the language, not the whole tag — `lang="de-DE"` is legal
 * but claims more than the store has said, since a locale is a choice about
 * how numbers and dates are written and not about which regional spelling the
 * copy uses. Falls back to `en`, which is the value the built shell ships.
 */
export function languageOf(locale: string): string {
  return locale.split("-")[0] || "en";
}
