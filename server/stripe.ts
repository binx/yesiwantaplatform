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
    appInfo: { name: "Yes I Want A Postcard" },
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

/**
 * Turn one of Stripe's own SDK errors into a status and a message a merchant
 * can act on.
 *
 * Left unmapped, every one of these reached `toHttp` as an unrecognised error
 * and became a 500 — an expired secret key on Publish looked identical to a
 * bug in Beluga. `null` for anything that is not a `StripeError`, so callers
 * fall through to their own handling.
 */
export function classifyStripeError(error: unknown): { status: number; message: string } | null {
  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    return {
      status: 502,
      message:
        "Stripe rejected the secret key — it has expired or been revoked. Replace STRIPE_SECRET_KEY and restart the API.",
    };
  }
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError
  ) {
    return { status: 502, message: "Stripe did not answer. Try again in a minute." };
  }
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return { status: 422, message: error.message };
  }
  if (error instanceof Stripe.errors.StripeRateLimitError) {
    return { status: 429, message: "Stripe is rate-limiting this account. Try again shortly." };
  }
  return null;
}

export type StripeKeyStatus = "valid" | "invalid" | "unchecked";

export interface StripeKeyCheck {
  status: StripeKeyStatus;
  livemode?: boolean;
  message?: string;
}

/**
 * Whether the configured secret key actually works, not just whether it is
 * set. `hasStripe` (see server/env.ts) only proves a value is present — the
 * review that this task closes found a green "Stripe is connected" sitting
 * above an expired test key, discovered only when Publish failed.
 * `"unchecked"` until `probeStripeKey` runs, and again if there is no key or
 * the probe could not reach Stripe at all: neither is the same claim as
 * "rejected", so neither should render as one.
 */
let keyCheck: StripeKeyCheck = { status: "unchecked" };

export function getStripeKeyCheck(): StripeKeyCheck {
  return keyCheck;
}

/**
 * Validate the configured key against Stripe and cache the answer.
 *
 * `balance.retrieve` is the cheapest authenticated call there is — the same
 * one `npm run setup` already uses to check a key before it is written.
 * Called once at boot (see server/index.ts); nothing here re-probes per
 * request.
 */
export async function probeStripeKey(): Promise<void> {
  const stripe = getStripe();
  if (!stripe) {
    keyCheck = { status: "unchecked" };
    return;
  }

  try {
    const balance = await stripe.balance.retrieve();
    keyCheck = { status: "valid", livemode: balance.livemode };
  } catch (error) {
    keyCheck = {
      status: "invalid",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

/** Test hook: drop the memoised client and cached probe after changing the environment. */
export function resetStripe(): void {
  client = null;
  keyCheck = { status: "unchecked" };
}
