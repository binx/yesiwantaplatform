import type { ThemeConfig } from "antd";
import type { Theme } from "@shared/schema";

/** Re-exported so client code has one import for theme concerns. */
export { defaultTheme } from "@shared/schema";

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
