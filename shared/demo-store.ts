import { defaultHero, defaultPricing, defaultTheme, type Store } from "./schema.js";

/**
 * The platform the site renders with `VITE_BELUGA_API=false`, and the
 * fixture the component tests render against. Conforms to the same schema as
 * the API's answer, so nothing downstream changes.
 */
export const demoStore: Store = {
  name: "Yes I Want A Postcard",
  stripePublishableKey: null,
  currency: "USD",
  locale: "en-US",
  pricing: defaultPricing,
  theme: { ...defaultTheme, fontUrl: null },
  hero: defaultHero,
  pages: [],
};
