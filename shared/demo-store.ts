import { defaultHero, defaultTheme, type Store } from "./schema.js";

/**
 * The store the storefront renders with `VITE_BELUGA_API=false`, and the
 * fixture the component tests render against. Conforms to the same schema as
 * the API's answer, so nothing downstream changes.
 */
export const demoStore: Store = {
  name: "Postcard Gifts",
  stripePublishableKey: null,
  currency: "USD",
  locale: "en-US",
  postcardPriceCents: 140,
  theme: { ...defaultTheme, fontUrl: null },
  hero: defaultHero,
  pages: [],
};
