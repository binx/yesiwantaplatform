import type { ThemeConfig } from "antd";
import type { Theme } from "@shared/schema";

/**
 * Beluga's default look.
 *
 * v1 shipped Material's rounded, mid-grey defaults. v2 aims at something
 * closer to an independent shop: near-black ink, a warm accent, and a 2px
 * radius so cards and buttons read as crisp rather than pill-shaped.
 * Every value here is overridable per store via the theme editor.
 */
export const defaultTheme: Theme = {
  colorPrimary: "#18181b",
  colorAccent: "#e07a5f",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
  borderRadius: 2,
};

/** Map a store's theme onto antd's design tokens. */
export function toAntdTheme(theme: Theme): ThemeConfig {
  return {
    token: {
      colorPrimary: theme.colorPrimary,
      colorInfo: theme.colorPrimary,
      colorLink: theme.colorPrimary,
      borderRadius: theme.borderRadius,
      fontFamily: theme.fontFamily,
      colorTextBase: "#18181b",
      colorBgLayout: "#fafaf9",
      colorBorder: "#e4e4e7",
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
