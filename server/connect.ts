import type Stripe from "stripe";
import { env } from "./env.js";
import { requireStripe } from "./stripe.js";
import { setArtistStripeAccount, type ArtistRecord } from "../db/artists-repository.js";

/**
 * Stripe Connect — how an artist gets paid.
 *
 * Each artist has an Express account. The platform charges every
 * subscription on its own account, and the payout sweep transfers each
 * card's share to the artist's account after the printer accepts the card
 * (see server/fulfilment.ts). Onboarding is Stripe's hosted flow: an Account
 * Link that expires in minutes, minted fresh each time the artist asks.
 *
 * `payouts_enabled` is Stripe's own word for "this account can receive
 * money", and it is the only thing the ledger checks. It is mirrored from
 * the `account.updated` webhook and from the studio's refresh button, so a
 * platform without Connect webhooks configured still catches up when the
 * artist comes back from onboarding.
 */

/** Make the artist's Express account if they have none, and return its id. */
export async function ensureConnectAccount(artist: ArtistRecord, email: string): Promise<string> {
  if (artist.stripeAccountId) return artist.stripeAccountId;
  const stripe = requireStripe();

  const account = await stripe.accounts.create(
    {
      type: "express",
      email,
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
      business_profile: { name: artist.name, product_description: "A monthly postcard subscription for an artist's work." },
      metadata: { yiwap_artist_id: artist.id },
    },
    // One account per artist however many times the button is pressed.
    { idempotencyKey: `connect-${artist.id}` },
  );

  await setArtistStripeAccount(artist.id, account.id, Boolean(account.payouts_enabled));
  return account.id;
}

/** A fresh onboarding link. Short-lived; the studio redirects straight to it. */
export async function createOnboardingLink(accountId: string): Promise<string> {
  const stripe = requireStripe();
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: new URL("/studio/earnings?onboarding=refresh", env.PUBLIC_URL).toString(),
    return_url: new URL("/studio/earnings?onboarding=return", env.PUBLIC_URL).toString(),
  });
  return link.url;
}

/** Ask Stripe whether the account can be paid, and remember the answer. */
export async function refreshConnectStatus(artist: ArtistRecord): Promise<boolean> {
  if (!artist.stripeAccountId) return false;
  const stripe = requireStripe();
  const account = await stripe.accounts.retrieve(artist.stripeAccountId);
  const enabled = Boolean(account.payouts_enabled);
  await setArtistStripeAccount(artist.id, artist.stripeAccountId, enabled);
  return enabled;
}

/** The same, from a webhook's copy of the account rather than a fetch. */
export async function recordConnectStatus(artist: ArtistRecord, account: Pick<Stripe.Account, "id" | "payouts_enabled">): Promise<void> {
  await setArtistStripeAccount(artist.id, account.id, Boolean(account.payouts_enabled));
}
