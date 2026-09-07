import Stripe from "stripe";
import { env } from "./env.js";

/**
 * Stripe client.
 *
 * v1 used stripe-node 6 against the SKUs and Orders APIs, both of which Stripe
 * has removed. v2 uses Products + Prices for the catalogue and Checkout
 * Sessions for payment, with orders stored locally because Orders has no
 * server-side replacement.
 *
 * The API version is pinned explicitly so a dependency bump cannot silently
 * change behaviour on a live store.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

let client: Stripe | null = null;

/** Null until a secret key is configured, so the app runs without Stripe. */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;

  client ??= new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "Beluga", url: "https://belugajs.com" },
    // Retry idempotently on network blips rather than failing a checkout.
    maxNetworkRetries: 2,
    timeout: 20_000,
  });

  return client;
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe is not configured. Set STRIPE_SECRET_KEY to accept payments.");
    this.name = "StripeNotConfiguredError";
  }
}

export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) throw new StripeNotConfiguredError();
  return stripe;
}

/** Test hook: drop the memoised client after changing the environment. */
export function resetStripe(): void {
  client = null;
}
