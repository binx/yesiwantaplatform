import type { EnvironmentStatus } from "@shared/api";
import { findCoverageGaps } from "@shared/shipping";
import { isLocalOrigin } from "@/lib/publicUrl";
import type { ProductSummary, ShippingTable } from "./queries";

/**
 * The checklist behind "Open the store" — see
 * docs/tasks/27-storefront-preview-mode.md §7.
 *
 * One module, three renderers (the Visibility card's checklist, its
 * confirmation on flipping to public, and eventually the Overview's Wiring
 * panel): a checklist that disagrees with the Overview is worse than no
 * checklist, so nothing computes these rows a second way.
 *
 * Every row reports what is true right now. None of them block the switch —
 * a catalogue-only store with no Stripe at all is a legitimate thing to open.
 */
export interface GoLiveRow {
  key: string;
  label: string;
  ok: boolean;
  /** What to do when `ok` is false. */
  hint: string;
  /** An admin page that fixes it, when there is one to link to. */
  href?: string;
}

export interface GoLiveInputs {
  environment: Pick<
    EnvironmentStatus,
    "hasStripeSecret" | "stripeMode" | "hasWebhookSecret" | "hasEmail" | "publicUrl"
  >;
  shipping?: ShippingTable | undefined;
  products?: ProductSummary[] | undefined;
}

/**
 * The cart a coverage gap is probed with — the same one
 * `DashboardPage.tsx`'s `Wiring` uses, and deliberately the same values: two
 * screens computing "does shipping cover this store" from different probes
 * could disagree about a store that is actually fine.
 */
const GAP_PROBE = { weightGrams: 100, subtotalCents: 1000 };

export function computeGoLiveRows({ environment, shipping, products }: GoLiveInputs): GoLiveRow[] {
  const shipsSomething = (products ?? []).some(
    (product) => product.isLive && product.kind === "physical",
  );
  const hasRates = (shipping?.rates.length ?? 0) > 0;
  const gaps = shipping ? findCoverageGaps(shipping.rates, shipping.zones, GAP_PROBE) : [];
  // A store selling only downloads needs no rates at all, so it passes with
  // none — the row exists for the store that ships and forgot to price it.
  const shippingOk = !shipsSomething || (hasRates && gaps.length === 0);

  const liveCount = (products ?? []).filter((product) => product.isLive).length;

  return [
    {
      key: "stripe",
      label: "Stripe is connected",
      ok: environment.hasStripeSecret,
      hint: "Set STRIPE_SECRET_KEY, then restart the API.",
    },
    {
      key: "stripe-live",
      label: "The Stripe key is a live key",
      ok: environment.hasStripeSecret && environment.stripeMode === "live",
      hint: environment.hasStripeSecret
        ? "Swap in a live secret key (sk_live_…), then restart the API."
        : "Connect Stripe first.",
    },
    {
      key: "webhooks",
      label: "Webhooks are connected",
      ok: environment.hasWebhookSecret,
      hint: "Set STRIPE_WEBHOOK_SECRET, then restart the API.",
    },
    {
      key: "public-url",
      label: "The public URL is not localhost",
      ok: !isLocalOrigin(environment.publicUrl),
      hint: "Set PUBLIC_URL to this store's real address, then restart the API.",
    },
    {
      key: "shipping",
      label: "Shipping has rates, and they cover where you ship",
      ok: shippingOk,
      hint: "Add rates that cover your destinations.",
      href: "/admin/shipping",
    },
    {
      key: "email",
      label: "Email can be sent",
      ok: environment.hasEmail,
      hint: "Set SMTP_URL and EMAIL_FROM, then restart the API.",
    },
    {
      key: "live-product",
      label: "Something is live to buy",
      ok: liveCount > 0,
      hint: "Publish at least one product.",
      href: "/admin/products",
    },
  ];
}
