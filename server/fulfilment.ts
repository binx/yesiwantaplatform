import { hasLob } from "./env.js";
import { imageStore } from "./image-store.js";
import { LobError, LobNotConfiguredError, sendPostcard } from "./lob.js";
import { sendPostcardSentEmail } from "./email.js";
import { todayIso } from "../shared/postcards.js";
import {
  claimPostcard,
  completeOrderIfDone,
  designHasUnsentPostcards,
  findDuePostcards,
  getOrder,
  markPostcardFailed,
  markPostcardSent,
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
 */

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A card claimed longer ago than this belonged to a sweep that died mid-send. */
const STALE_CLAIM_MS = 30 * 60 * 1000;

/** Retries for a transient failure before a card is parked for a person. */
const MAX_ATTEMPTS = 5;

/** How long a saved-but-unbought design is kept, and how long a sent design's thumbnail is. */
const ORPHAN_DESIGN_DAYS = 30;

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
  skipped: string | null;
}

/**
 * Send every card whose day has come.
 *
 * Runs to completion for each card before touching the next: claim, load the
 * design and its print file, send, record. A failure on one card is recorded
 * on that card and the loop moves on — a bad address must not hold up the
 * hundred good ones behind it, which is what v1's `return` inside the
 * callback did.
 */
export async function sendDuePostcards(today = todayIso()): Promise<SweepResult> {
  const result: SweepResult = { sent: 0, failed: 0, parked: 0, skipped: null };

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

  for (const row of due) {
    if (!(await claimPostcard(row.id))) continue;
    touchedOrders.add(row.orderId);

    const postcard = buildPostcard(row);
    const design = designById.get(row.designId);

    try {
      if (!design) throw new Error("The design for this postcard no longer exists.");
      if (!design.printPath) throw new Error("The print file for this design has already been removed.");

      const front = await imageStore.get(design.printPath);
      const lob = await sendPostcard({
        id: postcard.id,
        to: postcard.recipient,
        front,
        back: design.back,
        description: `Order ${row.orderId.slice(0, 8)} → ${postcard.recipient.name}`,
      });

      await markPostcardSent(postcard.id, lob);
      result.sent += 1;

      // Told after the row is written, so a crash between the two leaves a
      // sent card recorded as sent rather than an email about one that is not.
      const order = await getOrder(row.orderId);
      if (order) await sendPostcardSentEmail(order, { ...postcard, status: "sent", lobUrl: lob.url, expectedDeliveryDate: lob.expectedDeliveryDate });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        error instanceof LobError ? error.retryable : !(error instanceof LobNotConfiguredError);
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

  return result;
}

export interface CleanupResult {
  orphansDeleted: number;
  printFilesRemoved: number;
}

/**
 * Housekeeping, once every few hours.
 *
 *   - A design saved but never bought is deleted after a month, files and
 *     row. Nothing refers to it, and a public upload route without this is a
 *     free image host.
 *   - Once every card of an ordered design has gone to Lob, the print file
 *     (the large one) goes; the thumbnail stays so the order page still shows
 *     what was sent.
 *
 * v1 had four such crons and all four were commented out.
 */
export async function cleanUp(): Promise<CleanupResult> {
  const result: CleanupResult = { orphansDeleted: 0, printFilesRemoved: 0 };

  const cutoff = new Date(Date.now() - ORPHAN_DESIGN_DAYS * 24 * 60 * 60 * 1000);
  for (const design of await findOrphanDesigns(cutoff, BATCH)) {
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
