import Stripe from "stripe";
import { env, hasLob, hasStripe } from "./env.js";
import { imageStore } from "./image-store.js";
import { LobError, LobNotConfiguredError, sendPostcard } from "./lob.js";
import { sendMailingSentEmail, sendPostcardSentEmail } from "./email.js";
import { isInternational, todayIso } from "../shared/postcards.js";
import { artistShareCents } from "../shared/schema.js";
import { getSettings } from "../db/repository.js";
import { findArtistsByIds, getArtist } from "../db/artists-repository.js";
import { findDesignsByIds } from "../db/designs-repository.js";
import { findDueMailings, markMailingMailed } from "../db/mailings-repository.js";
import {
  buildPostcard,
  claimPostcard,
  findDuePostcards,
  markPostcardFailed,
  markPostcardSent,
  materialisePostcards,
  releasePostcard,
  releaseStalePostcards,
} from "../db/postcards-repository.js";
import { getSubscription, listActiveSubscriptionsForArtist } from "../db/subscriptions-repository.js";
import {
  claimPayout,
  findPayablePayouts,
  markPayoutFailed,
  markPayoutPaid,
  recordEarning,
  releaseStalePayouts,
} from "../db/payouts-repository.js";
import { findCustomerById } from "./auth.js";
import { getStripe } from "./stripe.js";

/**
 * Fulfilment: three sweeps, in the order money and paper move.
 *
 *   1. `sendDueMailings`  — a mailing whose day has come is turned into one
 *      postcard row per active subscriber.
 *   2. `sendDuePostcards` — each scheduled card is sent to Lob, and the
 *      moment Lob accepts it the card's share is written to the payout
 *      ledger.
 *   3. `sendPendingPayouts` — each pending ledger row whose artist can be
 *      paid is transferred through Stripe Connect.
 *
 * All three are `setInterval`s in the API process. What makes two instances
 * safe is not the timer but the conditional update each sweep claims with:
 * only one of two racing claims on the same row can win, so a duplicate tick
 * costs a wasted query, never two postcards in one letterbox or two
 * transfers for one card. Lob's idempotency key (our postcard id) and
 * Stripe's (our payout id) are the second belt on the same trousers.
 *
 * The print sweep is sequential on purpose. Lob allows 150 requests per five
 * seconds; one send uploads a print file and takes most of a second, so this
 * loop cannot reach that ceiling on its own. A 429 here means something
 * *else* is talking to Lob with the same key, and the right response is to
 * stop and let the next tick try.
 */

class ReturnAddressMissingError extends Error {
  constructor() {
    super("No return address is set; international mail needs one. Add it in Settings → Printing, then retry.");
    this.name = "ReturnAddressMissingError";
  }
}

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const PAYOUT_INTERVAL_MS = 60 * 60 * 1000;

/** A card or payout claimed longer ago than this belonged to a sweep that died mid-flight. */
const STALE_CLAIM_MS = 30 * 60 * 1000;

/**
 * Retries for a card-specific transient failure (a 5xx) before it is parked
 * for a person. Rate limits and outages do not count — see `releasePostcard`.
 */
const MAX_ATTEMPTS = 8;

/** The most a sweep will pause for Lob's `Retry-After` before giving the tick up. */
const RETRY_WAIT_CAP_MS = 10_000;
const RETRY_WAIT_DEFAULT_MS = 5_000;

/** Rows per sweep, so one enormous mailing day cannot hold the tick for an hour. */
const BATCH = 100;

/**
 * Whether the webhooks kick a sweep off on their own. On by default;
 * `createApp({ schedulers: false })` turns it off along with the timers, so a
 * test can drive each sweep itself and see the state it left.
 */
let autoSweep = true;

export function setAutoSweep(enabled: boolean): void {
  autoSweep = enabled;
}

/** The nudge after a mailing goes: send today's cards now rather than at the next tick. */
export function kickSweep(): void {
  if (!autoSweep) return;
  void sendDuePostcards().catch(logSweepError);
}

export interface SweepResult {
  sent: number;
  failed: number;
  parked: number;
  /** Why the sweep stopped early, when it did: no key, a rate limit, no answer from Lob. */
  skipped: string | null;
}

export interface SweepRun {
  /** When the sweep finished, epoch milliseconds. */
  at: number;
  result: SweepResult;
}

/** The most recent sweep, for the admin overview. In memory: a restart clears it and the next tick refills it. */
let lastRun: SweepRun | null = null;

export function getLastSweep(): SweepRun | null {
  return lastRun;
}

export interface SweepOptions {
  /** Ceiling on the one in-sweep pause for `Retry-After`. Tests set it low. */
  retryWaitCapMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------- mailings */

export interface MailingSweepResult {
  /** Mailings whose day came. */
  mailed: number;
  /** Postcard rows written across them. */
  postcards: number;
}

/**
 * Turn every due mailing into cards.
 *
 * The cards are written first and the mailing marked after: the unique index
 * on (mailing, subscription) makes the write idempotent, so a crash between
 * the two, or two instances ticking at once, leaves nothing missing and
 * nothing doubled. Only the instance whose mark wins tells the artist.
 */
export async function sendDueMailings(today = todayIso()): Promise<MailingSweepResult> {
  const result: MailingSweepResult = { mailed: 0, postcards: 0 };
  const due = await findDueMailings(today, BATCH);
  if (due.length === 0) return result;

  for (const mailing of due) {
    try {
      const subscriptions = await listActiveSubscriptionsForArtist(mailing.artistId);
      const written = await materialisePostcards(mailing, subscriptions);
      if (!(await markMailingMailed(mailing.id, subscriptions.length))) continue;

      result.mailed += 1;
      result.postcards += written;
      console.log(`[fulfilment] mailing ${mailing.id} went to ${subscriptions.length} subscriber${subscriptions.length === 1 ? "" : "s"}.`);

      const artist = await getArtist(mailing.artistId);
      const owner = artist ? await findCustomerById(artist.customerId) : null;
      if (artist && owner) await sendMailingSentEmail(owner.email, { artistName: artist.name, subscriberCount: subscriptions.length, mailDate: mailing.mailDate, title: mailing.title });
    } catch (error) {
      console.error(`[fulfilment] mailing ${mailing.id} could not be sent:`, error);
    }
  }

  // The cards just written are dated today: send them now, not in fifteen minutes.
  if (result.postcards > 0) kickSweep();
  return result;
}

/* --------------------------------------------------------------- postcards */

/**
 * Send every card whose day has come.
 *
 * Runs to completion for each card before touching the next: claim, load the
 * design and its print file, send, record, ledger. A failure on one card is
 * recorded on that card and the loop moves on — a bad address must not hold
 * up the hundred good ones behind it.
 *
 * The one exception is a *stall*: a 429, or no HTTP answer at all. That is
 * not about the card, and carrying on would walk every remaining card into
 * the same wall. So the card is put back unchanged and the sweep stops.
 */
export async function sendDuePostcards(today = todayIso(), options: SweepOptions = {}): Promise<SweepResult> {
  const result: SweepResult = { sent: 0, failed: 0, parked: 0, skipped: null };
  const retryWaitCap = options.retryWaitCapMs ?? RETRY_WAIT_CAP_MS;

  if (!hasLob) {
    result.skipped = "LOB_API_KEY is not set, so nothing goes to print.";
    lastRun = { at: Date.now(), result };
    return result;
  }

  await releaseStalePostcards(new Date(Date.now() - STALE_CLAIM_MS));

  const due = await findDuePostcards(today, BATCH);
  if (due.length === 0) {
    lastRun = { at: Date.now(), result };
    return result;
  }

  const designs = await findDesignsByIds(due.map((row) => row.designId));
  const designById = new Map(designs.map((design) => [design.id, design]));
  const artists = await findArtistsByIds(due.map((row) => row.artistId));
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));
  let pausedOnce = false;
  // Read once per sweep: the return address goes on every card, and the
  // pricing on every ledger row.
  const settings = await getSettings();
  const returnAddress = settings?.returnAddress ?? null;
  const siteName = settings?.name ?? "Yes I Want A Postcard";

  for (const row of due) {
    if (!(await claimPostcard(row.id))) continue;

    const postcard = buildPostcard(row);
    const design = designById.get(row.designId);
    const artist = artistById.get(row.artistId);

    try {
      if (!design) throw new Error("The design for this postcard no longer exists.");
      if (!artist) throw new Error("The artist for this postcard no longer exists.");

      // Ours, not Lob's: there is no request to refuse yet. Parked for the
      // admin, who can add the address in Settings → Printing and Retry.
      if (isInternational(postcard.recipient) && !returnAddress) {
        throw new ReturnAddressMissingError();
      }

      const front = await imageStore.get(design.printPath);
      const input = {
        id: postcard.id,
        to: postcard.recipient,
        from: returnAddress,
        front,
        back: design.back,
        description: `${artist.name} → ${postcard.recipient.name} (${row.mailDate})`,
        footer: { artistName: artist.name, siteName },
      };

      let lob;
      try {
        lob = await sendPostcard(input);
      } catch (error) {
        // One short pause on the sweep's first rate limit, then the same card again.
        if (!(error instanceof LobError && error.status === 429) || pausedOnce) throw error;
        pausedOnce = true;
        await sleep(Math.min(error.retryAfterMs ?? RETRY_WAIT_DEFAULT_MS, retryWaitCap));
        lob = await sendPostcard(input);
      }

      await markPostcardSent(postcard.id, lob);
      result.sent += 1;

      // The ledger row, with the numbers as they are right now. Written
      // after the card is recorded sent, so a crash between the two leaves
      // a sent card unpaid — which the admin can see — rather than a paid
      // card unsent, which nobody could.
      const subscription = await getSubscription(row.subscriptionId);
      if (subscription && settings) {
        const share = artistShareCents(subscription.priceCents, settings.pricing);
        await recordEarning({
          artistId: row.artistId,
          postcardId: postcard.id,
          mailingId: row.mailingId,
          grossCents: subscription.priceCents,
          printCostCents: settings.pricing.printCostCents,
          platformFeeCents: settings.pricing.platformFeeCents,
          amountCents: share,
          currency: subscription.currency,
        });
      }

      // Told after the row is written, so a crash between the two leaves a
      // sent card recorded as sent rather than an email about one that is not.
      const recipient = subscription ? await findCustomerById(subscription.customerId) : null;
      if (recipient) {
        await sendPostcardSentEmail(recipient.email, {
          artistName: artist.name,
          artistSlug: artist.slug,
          recipientName: postcard.recipient.name,
          expectedDeliveryDate: lob.expectedDeliveryDate,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (error instanceof LobError && error.stall) {
        await releasePostcard(postcard.id, message);
        result.skipped =
          error.status === 429
            ? "Lob rate-limited the sweep; the next tick will resume."
            : "Lob could not be reached; the next tick will resume.";
        console.error(`[fulfilment] stopped at postcard ${postcard.id}: ${message}`);
        break;
      }

      const retryable =
        error instanceof LobError ? error.retryable : !(error instanceof LobNotConfiguredError || error instanceof ReturnAddressMissingError);
      // `attempts` was incremented by the claim, so this is the count so far.
      const outcome = retryable && row.attempts + 1 < MAX_ATTEMPTS ? "retry" : "error";

      await markPostcardFailed(postcard.id, message, outcome);
      if (outcome === "retry") result.failed += 1;
      else result.parked += 1;

      console.error(`[fulfilment] postcard ${postcard.id}: ${message} (${outcome})`);
    }
  }

  if (result.sent + result.failed + result.parked > 0) {
    console.log(`[fulfilment] ${result.sent} sent, ${result.failed} to retry, ${result.parked} need attention.`);
  }

  lastRun = { at: Date.now(), result };
  return result;
}

/* ----------------------------------------------------------------- payouts */

export interface PayoutSweepResult {
  paid: number;
  /** Transfers Stripe refused for a reason that will not change. */
  failed: number;
  /** Put back for the next tick: no balance yet, or Stripe did not answer. */
  deferred: number;
  skipped: string | null;
}

/** The most recent payout sweep, for the admin. */
let lastPayoutRun: { at: number; result: PayoutSweepResult } | null = null;

export function getLastPayoutSweep(): { at: number; result: PayoutSweepResult } | null {
  return lastPayoutRun;
}

/** Whether a Stripe refusal is worth trying again later. */
function payoutOutcome(error: unknown): "retry" | "failed" | "stall" {
  if (error instanceof Stripe.errors.StripeRateLimitError || error instanceof Stripe.errors.StripeConnectionError) return "stall";
  if (error instanceof Stripe.errors.StripeAPIError) return "retry";
  // No money in the platform balance yet: Stripe settles card payments over
  // days, and a transfer before then is refused with this code. Not the
  // artist's problem and not permanent.
  if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "balance_insufficient") return "retry";
  return "failed";
}

/**
 * Transfer every pending share to its artist.
 *
 * One transfer per ledger row, keyed on the row id: a retried request cannot
 * pay twice, and the ledger row is the record of what was paid for what.
 * Rows for artists who have not finished Stripe onboarding are not returned
 * by the query at all; they wait, and the studio says so.
 */
export async function sendPendingPayouts(): Promise<PayoutSweepResult> {
  const result: PayoutSweepResult = { paid: 0, failed: 0, deferred: 0, skipped: null };
  const stripe = getStripe();

  if (!hasStripe || !stripe) {
    result.skipped = "STRIPE_SECRET_KEY is not set, so nothing can be transferred.";
    lastPayoutRun = { at: Date.now(), result };
    return result;
  }

  await releaseStalePayouts(new Date(Date.now() - STALE_CLAIM_MS));
  const due = await findPayablePayouts(BATCH);

  for (const payout of due) {
    if (!(await claimPayout(payout.id))) continue;

    const artist = await getArtist(payout.artistId);
    if (!artist?.stripeAccountId || !artist.payoutsEnabled) {
      await markPayoutFailed(payout.id, "The artist's Stripe account is not ready to be paid.", "retry");
      result.deferred += 1;
      continue;
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: payout.amountCents,
          currency: payout.currency.toLowerCase(),
          destination: artist.stripeAccountId,
          transfer_group: payout.mailingId,
          description: `Postcard ${payout.postcardId.slice(0, 8)} — ${artist.name}`,
          metadata: { yiwap_payout_id: payout.id, yiwap_postcard_id: payout.postcardId, yiwap_artist_id: artist.id },
        },
        { idempotencyKey: `payout-${payout.id}` },
      );
      await markPayoutPaid(payout.id, transfer.id);
      result.paid += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = payoutOutcome(error);

      if (outcome === "stall") {
        await markPayoutFailed(payout.id, message, "retry");
        result.deferred += 1;
        result.skipped = "Stripe did not answer; the next tick will resume.";
        console.error(`[payouts] stopped at payout ${payout.id}: ${message}`);
        break;
      }

      const final = outcome === "failed" || payout.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "retry";
      await markPayoutFailed(payout.id, message, final);
      if (final === "retry") result.deferred += 1;
      else result.failed += 1;
      console.error(`[payouts] payout ${payout.id}: ${message} (${final})`);
    }
  }

  if (result.paid + result.failed + result.deferred > 0) {
    console.log(`[payouts] ${result.paid} paid, ${result.deferred} deferred, ${result.failed} failed.`);
  }

  lastPayoutRun = { at: Date.now(), result };
  return result;
}

/* --------------------------------------------------------------- scheduler */

/** The scheduler. Unref'd so it never holds the process open. */
export function startFulfilmentScheduler(): { close: () => void } {
  const tick = () =>
    void sendDueMailings()
      .then(() => sendDuePostcards())
      .catch(logSweepError);

  const sweep = setInterval(tick, SWEEP_INTERVAL_MS);
  const payouts = setInterval(() => void sendPendingPayouts().catch(logSweepError), PAYOUT_INTERVAL_MS);
  sweep.unref();
  payouts.unref();

  // Once shortly after boot too: a server that was down over a mailing day
  // should not wait another fifteen minutes to catch up.
  const initial = setTimeout(tick, 10_000);
  const initialPayouts = setTimeout(() => void sendPendingPayouts().catch(logSweepError), 60_000);
  initial.unref();
  initialPayouts.unref();

  return {
    close: () => {
      clearInterval(sweep);
      clearInterval(payouts);
      clearTimeout(initial);
      clearTimeout(initialPayouts);
    },
  };
}

function logSweepError(error: unknown): void {
  console.error("[fulfilment] sweep failed:", error);
}

/** Exported for the boot log. */
export const PUBLIC_URL = env.PUBLIC_URL;
