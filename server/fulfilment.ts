import { env, hasLob } from "./env.js";
import { imageStore } from "./image-store.js";
import { LobError, LobNotConfiguredError, sendPostcard } from "./lob.js";
import { sendPostcardSentEmail } from "./email.js";
import { isInternational, todayIso } from "../shared/postcards.js";
import { getSettings } from "../db/repository.js";
import {
  claimPostcard,
  completeOrderIfDone,
  designHasUnsentPostcards,
  findDuePostcards,
  getOrder,
  markPostcardFailed,
  markPostcardSent,
  releasePostcard,
  releaseStalePostcards,
  buildPostcard,
} from "../db/orders-repository.js";
import {
  deleteDesign,
  findDesignsByIds,
  findOrderedDesignsWithPrintFile,
  findOrphanDesigns,
  markPrintFileRemoved,
} from "../db/designs-repository.js";
import { deleteDesignFile } from "./uploads.js";

/**
 * Fulfilment: the sweep that sends due postcards to Lob, and the housekeeping
 * around it.
 *
 * v1 ran this on an hourly `node-cron`. Here it is a `setInterval` in the API
 * process — the same shape as the cart-recovery sweep and the session store's
 * prune timer — and what makes two instances safe is not the timer but
 * `claimPostcard`'s conditional update: only one of two racing claims on the
 * same card can win, so a duplicate tick costs a wasted query, never two
 * postcards in one letterbox. Lob's idempotency key (our postcard id) is the
 * second belt on the same trousers.
 *
 * The sweep is sequential on purpose. Lob allows 150 requests per five
 * seconds; one send uploads a print file and takes most of a second, so this
 * loop cannot reach that ceiling on its own. A 429 here means something
 * *else* is talking to Lob with the same key — address verification, a
 * second instance — and the right response is to stop and let the next tick
 * try, not to add concurrency to "speed it up".
 */

class ReturnAddressMissingError extends Error {
  constructor() {
    super("No return address is set; international mail needs one. Add it in Settings → Printing, then retry.");
    this.name = "ReturnAddressMissingError";
  }
}

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A card claimed longer ago than this belonged to a sweep that died mid-send. */
const STALE_CLAIM_MS = 30 * 60 * 1000;

/**
 * Retries for a card-specific transient failure (a 5xx) before it is parked
 * for a person. Rate limits and outages do not count — see `releasePostcard`
 * — so eight ticks is two hours of Lob objecting to one particular card.
 */
const MAX_ATTEMPTS = 8;

/** The most a sweep will pause for Lob's `Retry-After` before giving the tick up. */
const RETRY_WAIT_CAP_MS = 10_000;
const RETRY_WAIT_DEFAULT_MS = 5_000;

/** How long a guest's saved-but-unbought design is kept. */
const ORPHAN_DESIGN_DAYS = 30;
/** A customer's drafts stay six months: they can see them in the gallery, and delete them themselves. */
const CUSTOMER_DRAFT_DAYS = 180;

/** Cards per sweep, so one enormous mailing day cannot hold the tick for an hour. */
const BATCH = 100;

/**
 * Whether the payment webhook kicks a sweep off on its own. On by default;
 * `createApp({ schedulers: false })` turns it off along with the timers, so a
 * test can drive `sendDuePostcards` itself and see the state it left.
 */
let autoSweep = true;

export function setAutoSweep(enabled: boolean): void {
  autoSweep = enabled;
}

/** The webhook's nudge: send today's cards now rather than at the next tick. */
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

/**
 * Send every card whose day has come.
 *
 * Runs to completion for each card before touching the next: claim, load the
 * design and its print file, send, record. A failure on one card is recorded
 * on that card and the loop moves on — a bad address must not hold up the
 * hundred good ones behind it, which is what v1's `return` inside the
 * callback did.
 *
 * The one exception is a *stall*: a 429, or no HTTP answer at all. That is
 * not about the card, and carrying on would walk every remaining card into
 * the same wall, each one burning an attempt. So the card is put back
 * unchanged and the sweep stops; the next tick is fifteen minutes away. On
 * the first 429 of a sweep Lob's `Retry-After` is honoured once, briefly,
 * in case the limit was a burst rather than a condition.
 */
export async function sendDuePostcards(today = todayIso(), options: SweepOptions = {}): Promise<SweepResult> {
  const result: SweepResult = { sent: 0, failed: 0, parked: 0, skipped: null };
  const retryWaitCap = options.retryWaitCapMs ?? RETRY_WAIT_CAP_MS;

  if (!hasLob) {
    result.skipped = "LOB_API_KEY is not set, so nothing goes to print.";
    return result;
  }

  await releaseStalePostcards(new Date(Date.now() - STALE_CLAIM_MS));

  const due = await findDuePostcards(today, BATCH);
  if (due.length === 0) return result;

  const designs = await findDesignsByIds(due.map((row) => row.designId));
  const designById = new Map(designs.map((design) => [design.id, design]));
  const touchedOrders = new Set<string>();
  let pausedOnce = false;
  // Read once per sweep: the return address goes on every international card.
  const returnAddress = (await getSettings())?.returnAddress ?? null;

  for (const row of due) {
    if (!(await claimPostcard(row.id))) continue;
    touchedOrders.add(row.orderId);

    const postcard = buildPostcard(row);
    const design = designById.get(row.designId);

    try {
      if (!design) throw new Error("The design for this postcard no longer exists.");
      if (!design.printPath) throw new Error("The print file for this design has already been removed.");

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
        description: `Order ${row.orderId.slice(0, 8)} → ${postcard.recipient.name}`,
        replyUrl: postcard.replyCode ? new URL(`/r/${postcard.replyCode}`, env.PUBLIC_URL).toString() : null,
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

      // Told after the row is written, so a crash between the two leaves a
      // sent card recorded as sent rather than an email about one that is not.
      const order = await getOrder(row.orderId);
      if (order) await sendPostcardSentEmail(order, { ...postcard, status: "sent", lobUrl: lob.url, expectedDeliveryDate: lob.expectedDeliveryDate });
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

  for (const orderId of touchedOrders) await completeOrderIfDone(orderId);

  if (result.sent + result.failed + result.parked > 0) {
    console.log(
      `[fulfilment] ${result.sent} sent, ${result.failed} to retry, ${result.parked} need attention.`,
    );
  }

  lastRun = { at: Date.now(), result };
  return result;
}

export interface CleanupResult {
  orphansDeleted: number;
  printFilesRemoved: number;
}

/**
 * Housekeeping, once every few hours.
 *
 *   - A guest's design saved but never bought is deleted after a month,
 *     files and row; a customer's draft after six months. Nothing refers to
 *     either, and a public upload route without this is a free image host.
 *   - Once every card of a guest's ordered design has gone to Lob, the print
 *     file (the large one) goes; the thumbnail stays so the order page still
 *     shows what was sent. A customer's print files are kept: they are what
 *     makes "send again" print exactly the same card.
 *
 * v1 had four such crons and all four were commented out.
 */
export async function cleanUp(): Promise<CleanupResult> {
  const result: CleanupResult = { orphansDeleted: 0, printFilesRemoved: 0 };

  const guestCutoff = new Date(Date.now() - ORPHAN_DESIGN_DAYS * 24 * 60 * 60 * 1000);
  const draftCutoff = new Date(Date.now() - CUSTOMER_DRAFT_DAYS * 24 * 60 * 60 * 1000);
  const orphans = [...(await findOrphanDesigns(guestCutoff, BATCH, "guest")), ...(await findOrphanDesigns(draftCutoff, BATCH, "customer"))];
  for (const design of orphans) {
    try {
      if (design.printPath) await deleteDesignFile(design.printPath);
      await deleteDesignFile(design.thumbnailPath);
      await deleteDesign(design.id);
      result.orphansDeleted += 1;
    } catch (error) {
      console.error(`[fulfilment] could not remove design ${design.id}:`, error);
    }
  }

  for (const design of await findOrderedDesignsWithPrintFile(BATCH)) {
    if (!design.printPath) continue;
    if (await designHasUnsentPostcards(design.id)) continue;

    try {
      await deleteDesignFile(design.printPath);
      await markPrintFileRemoved(design.id);
      result.printFilesRemoved += 1;
    } catch (error) {
      console.error(`[fulfilment] could not trim design ${design.id}:`, error);
    }
  }

  return result;
}

/** The scheduler. Unref'd so it never holds the process open. */
export function startFulfilmentScheduler(): { close: () => void } {
  const sweep = setInterval(() => void sendDuePostcards().catch(logSweepError), SWEEP_INTERVAL_MS);
  const cleanup = setInterval(() => void cleanUp().catch(logSweepError), CLEANUP_INTERVAL_MS);
  sweep.unref();
  cleanup.unref();

  // Once shortly after boot too: a server that was down over a mailing day
  // should not wait another fifteen minutes to catch up.
  const initial = setTimeout(() => void sendDuePostcards().catch(logSweepError), 10_000);
  initial.unref();

  return {
    close: () => {
      clearInterval(sweep);
      clearInterval(cleanup);
      clearTimeout(initial);
    },
  };
}

function logSweepError(error: unknown): void {
  console.error("[fulfilment] sweep failed:", error);
}
