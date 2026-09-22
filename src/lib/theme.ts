import { theme as antdTheme, type ThemeConfig } from "antd";
import type { ColorScheme, Theme } from "@shared/schema";

/** Re-exported so client code has one import for theme concerns. */
export { defaultTheme } from "@shared/schema";

/**
 * The two base palettes, and the only place either is written down.
 *
 * `index.css` carries a copy of the light values as a first-paint fallback and
 * says so; nothing else should hardcode these.
 */
interface Palette {
  ink: string;
  muted: string;
  line: string;
  surface: string;
  page: string;
}

const schemePalette: Record<ColorScheme, Palette> = {
  light: {
    ink: "#18181b",
    // Darker than antd's own secondary grey: it has to clear 4.5:1 on a warm paper page, not only on white.
    muted: "#64646b",
    line: "#e4e4e7",
    surface: "#ffffff",
    page: "#fafaf9",
  },
  // Night: the platform's own scheme, and its default. Blue-black rather
  // than warm grey, so the chroma (index.css) reads as light on metal.
  dark: {
    ink: "#f4f2ff",
    muted: "#a7a3c4",
    line: "#27263d",
    surface: "#12111f",
    page: "#07070f",
  },
};

/** The r, g, b channels of a `#rrggbb` colour, or null if it is not one. */
function channels(color: string): [number, number, number] | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return null;

  const int = Number.parseInt(hex, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Relative luminance per WCAG 2.x. Non-hex input reads as dark, so text on it
 *  defaults to white rather than throwing. */
function relativeLuminance(color: string): number {
  const rgb = channels(color);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Blend two colours in sRGB; `amount` is how much of `a` survives.
 *
 * Used to tint a surface with the store's own primary. Non-hex input falls
 * back to `b` untouched, matching `relativeLuminance`'s refusal to throw on a
 * colour it cannot read.
 */
function mix(a: string, b: string, amount: number): string {
  const from = channels(a);
  const to = channels(b);
  if (!from || !to) return b;

  return `#${from
    .map((channel, i) => Math.round(channel * amount + (to[i] as number) * (1 - amount)))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Ink or white, whichever stays legible on top of `background`.
 *
 * A shop picking its own primary and accent can land anywhere on the range, and
 * a "Sold out" badge that turns white-on-pale-yellow is worse than no badge.
 */
function readableOn(background: string): string {
  /*
   * Ask which of the two actually wins, rather than guessing from a luminance
   * cutoff. The old 0.45 threshold picked white for the default accent
   * (#e07a5f, luminance 0.31) and got 2.95:1 on the "Sold out" badge; ink on
   * that same accent is 6.01:1. The crossover sits near 0.18, not 0.45, so a
   * hand-picked threshold was always going to be wrong somewhere on the range.
   */
  return contrastRatio("#18181b", background) >= contrastRatio("#ffffff", background)
    ? "#18181b"
    : "#ffffff";
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const [lumA, lumB] = [relativeLuminance(a), relativeLuminance(b)];
  const [lighter, darker] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];

  return (lighter + 0.05) / (darker + 0.05);
}

/** The background the storefront actually paints, scheme default included. */
export function effectivePageColor(theme: Theme): string {
  return theme.colorPage ?? schemePalette[theme.colorScheme].page;
}

/**
 * The store's theme as CSS custom properties.
 *
 * This is the bridge that was missing: the CSS Modules across the storefront
 * were all reading `--beluga-ink` and friends from a fixed `:root` block, so a
 * shop could set a primary colour and watch the banner, carousel and product
 * page ignore it. Now the same theme feeds both antd's tokens and the
 * stylesheet, and there is one answer to "what colour is this store".
 */
export function themeCssVars(theme: Theme): Record<string, string> {
  const palette = schemePalette[theme.colorScheme];

  return {
    "--beluga-ink": palette.ink,
    "--beluga-muted": palette.muted,
    "--beluga-line": palette.line,
    "--beluga-surface": palette.surface,
    // A shop that sets a background means it; otherwise follow the scheme.
    "--beluga-page": theme.colorPage ?? palette.page,
    "--beluga-primary": theme.colorPrimary,
    "--beluga-on-primary": readableOn(theme.colorPrimary),
    "--beluga-accent": theme.colorAccent,
    "--beluga-on-accent": readableOn(theme.colorAccent),
    "--beluga-radius": `${theme.borderRadius}px`,
  };
}

/**
 * The colour of every primary button on the storefront.
 *
 * Deliberately not the store's primary: that colour also carries links, focus
 * rings and selected rows, and the near-black it defaults to made "Save this
 * design" and "Add to cart" read as chrome rather than as the thing to press.
 * The label is always ink, whatever the scheme — dark text is what stays
 * legible on a yellow this bright (12.7:1 against `#18181b`).
 */
export const ACTION_BUTTON = {
  fill: "#ffd60a",
  hover: "#ffe14d",
  active: "#f0c500",
  label: "#18181b",
} as const;

/** Map a store's theme onto antd's design tokens. */
export function toAntdTheme(theme: Theme): ThemeConfig {
  const palette = schemePalette[theme.colorScheme];
  const isDark = theme.colorScheme === "dark";

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: theme.colorPrimary,
      colorInfo: theme.colorPrimary,
      colorLink: theme.colorPrimary,
      borderRadius: theme.borderRadius,
      fontFamily: theme.fontFamily,
      colorTextBase: palette.ink,
      colorBgBase: palette.surface,
      colorBgLayout: theme.colorPage ?? palette.page,
      colorBorder: palette.line,
      fontSize: 15,
      wireframe: false,
      /*
       * antd derives the "chosen item" background from `colorPrimary`. Beluga's
       * default primary is near-black, so that derivation landed on a dark grey
       * while the label on top stayed dark ink — 2.03:1, and in a multi-select
       * every option already chosen rendered that way. Tint the surface with
       * the primary instead of letting antd shade the primary itself.
       */
      controlItemBgActive: mix(theme.colorPrimary, palette.surface, 0.1),
      controlItemBgActiveHover: mix(theme.colorPrimary, palette.surface, 0.16),
      /*
       * antd fades secondary text out of `colorTextBase` by alpha. From this
       * palette's near-black ink that landed on #949495, which is 2.9:1 on the
       * page — every `Result` subtitle on /confirm and /unsubscribe failed.
       * `muted` is the storefront's own answer to the same question and clears
       * 4.5:1 against both page and surface in both schemes, so use it rather
       * than let antd derive a second, dimmer grey alongside it.
       */
      colorTextSecondary: palette.muted,
      colorTextTertiary: palette.muted,
      colorTextDescription: palette.muted,
      /*
       * antd derives a placeholder from `colorTextBase` at low opacity, same
       * failure mode as the secondary/tertiary/description trio above: from
       * near-black ink that lands well under 4.5:1 on a light surface. The
       * state picker's "Select" is the first placeholder the storefront
       * ever showed long enough to be read rather than instantly replaced.
       */
      colorTextPlaceholder: palette.muted,
    },
    components: {
      Button: {
        // Uppercase, letterspaced labels read as retail rather than dashboard.
        fontWeight: 500,
        primaryShadow: "none",
        defaultShadow: "none",
        // Primary buttons are the bright yellow, not the theme's primary — see ACTION_BUTTON.
        colorPrimary: ACTION_BUTTON.fill,
        colorPrimaryHover: ACTION_BUTTON.hover,
        colorPrimaryActive: ACTION_BUTTON.active,
        primaryColor: ACTION_BUTTON.label,
        // antd colours a default button's hover and active states from the
        // same primary, which would put pale yellow text on a white button.
        // Those stay on the store's primary, as they were.
        defaultHoverColor: theme.colorPrimary,
        defaultHoverBorderColor: theme.colorPrimary,
        defaultActiveColor: theme.colorPrimary,
        defaultActiveBorderColor: theme.colorPrimary,
      },
      Card: {
        paddingLG: 28,
      },
      Select: {
        // Both halves of the pair are pinned; leaving the text to be derived
        // is what let the background drift away from it in the first place.
        optionSelectedBg: mix(theme.colorPrimary, palette.surface, 0.1),
        optionSelectedColor: palette.ink,
      },
      Table: {
        headerBg: "transparent",
      },
      Segmented: {
        // antd's unselected label is a 65% alpha grey that lands under 4.5:1 on the track.
        itemColor: palette.muted,
        itemHoverColor: palette.ink,
      },
    },
  };
}

/**
 * The `family=` names out of a Google Fonts `css2` URL, order preserved.
 *
 * `ThemeEditor` uses this to warn when the stylesheet a merchant pasted
 * defines a face the selected font stack never names — the URL and the stack
 * are otherwise two fields with no relationship between them. Only `css2`
 * URLs are parsed: it is the one shape whose `family=` value is reliably a
 * font name, and a self-hosted `@font-face` sheet gives no such hint to read
 * without fetching and parsing the stylesheet itself, which is what the
 * server does at save time — not worth repeating here just to draw a hint.
 *
 * A family can carry an axis spec after a colon, e.g. `Fraunces:ital,opsz@…`;
 * everything from the first `:` on is dropped.
 */
export function googleFontFamilies(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  if (parsed.hostname !== "fonts.googleapis.com" || !parsed.pathname.startsWith("/css2")) {
    return [];
  }

  return parsed.searchParams.getAll("family").map((family) => family.split(":")[0]!.trim());
}
