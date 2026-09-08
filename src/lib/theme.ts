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
    muted: "#71717a",
    line: "#e4e4e7",
    surface: "#ffffff",
    page: "#fafaf9",
  },
  dark: {
    ink: "#fafaf9",
    muted: "#a1a1aa",
    line: "#3f3f46",
    surface: "#1c1917",
    page: "#0c0a09",
  },
};

/** Relative luminance per WCAG 2.x. Non-hex input reads as dark, so text on it
 *  defaults to white rather than throwing. */
function relativeLuminance(color: string): number {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return 0;

  const int = Number.parseInt(hex, 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Ink or white, whichever stays legible on top of `background`.
 *
 * A shop picking its own primary and accent can land anywhere on the range, and
 * a "Sold out" badge that turns white-on-pale-yellow is worse than no badge.
 */
function readableOn(background: string): string {
  return relativeLuminance(background) > 0.45 ? "#18181b" : "#ffffff";
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
    },
    components: {
      Button: {
        // Uppercase, letterspaced labels read as retail rather than dashboard.
        fontWeight: 500,
        primaryShadow: "none",
        defaultShadow: "none",
      },
      Card: {
        paddingLG: 28,
      },
      Table: {
        headerBg: "transparent",
      },
    },
  };
}
