import { defaultTheme, type Theme } from "@shared/schema";
import { toAntdTheme } from "@/lib/theme";

/**
 * The theme for Beluga's own chrome — the admin, and the setup wizard.
 *
 * Deliberately its own palette rather than the store's. A shop is free to
 * configure white-on-white or a 24px radius; that is its business, and it
 * should not be able to make its own control panel unreadable. The store's
 * theme is previewed where it is edited, and nowhere else in here.
 *
 * Nor is it the platform's default any more: that default went dark when the
 * public site did, and the admin's page chrome (`AdminLayout`, `LoginPage`,
 * `SetupPage`) is a literal light palette. The control panel stays light,
 * near-black on paper, whatever the site in front of it looks like.
 *
 * It lives in its own module because two routes need it and neither contains
 * the other: `/admin` renders it from `AdminRoot`, and `/setup` is a sibling
 * top-level route rather than a child of that. Leaving the wizard to antd's
 * stock theme is what put three failing contrast ratios on the first page a
 * new operator ever sees — see `SetupPage`.
 */
const controlPanel: Theme = {
  ...defaultTheme,
  colorScheme: "light",
  colorPage: "#fafaf9",
  colorPrimary: "#1c1917",
  colorAccent: "#f5c542",
};

const base = toAntdTheme(controlPanel);

/**
 * `colorInfo` is put back to a real blue.
 *
 * The storefront maps it onto the primary colour so a single accent carries
 * the whole shop, which is right there — but the admin uses `Alert type="info"`
 * for ordinary "here is how this works" notices, and Beluga's near-black
 * primary turned every one of them into a black slab that reads as a failure.
 * Severity has to be legible in a control panel.
 */
export const adminTheme = {
  ...base,
  token: { ...base.token, colorInfo: "#2563eb", colorLink: "#2563eb" },
  components: {
    ...base.components,
    // The storefront's yellow action button is the shop's, not the control panel's.
    Button: { fontWeight: 500, primaryShadow: "none", defaultShadow: "none" },
  },
};
