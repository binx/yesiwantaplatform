import { randomBytes } from "node:crypto";
import type { CartLine } from "../shared/cart.js";
import { countPostcards } from "../shared/cart.js";
import type { Order } from "../shared/orders.js";
import { formatRecipient } from "../shared/postcards.js";
import { formatMoney } from "../shared/money.js";
import { getSettings } from "../db/repository.js";
import { findDesignsByIds } from "../db/designs-repository.js";
import {
  claimReminder,
  findCartByRecoveryTokenHash,
  findCartsDueForReminder,
  markActiveCartRecovered,
  redeemRecoveryToken,
  upsertActiveCart,
  type CartRow,
} from "../db/carts-repository.js";
import {
  optOutOfCartRecoveryByTokenHash,
  setCartRecoveryUnsubscribeTokenHash,
} from "../db/customers-repository.js";
import { findCustomerById, hashToken } from "./auth.js";
import { sendCartRecoveryEmail } from "./email.js";
import { env } from "./env.js";

/**
 * Cart persistence, the recovery email, and the sweep that sends it.
 *
 * Only ever acts for a signed-in customer with a verified, non-suppressed
 * email — a guest cart never reaches the server before checkout, so there is
 * no address to contact and nothing worth storing.
 */

/** Expiry is computed from `reminderSentAt` at redemption time — no separate column. */
const RECOVERY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export class CartTokenNotUsableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartTokenNotUsableError";
  }
}

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  return null;
}

/** Sync a signed-in customer's cart. A no-op while the feature is off. */
export async function syncCart(customerId: string, lines: CartLine[]): Promise<void> {
  const settings = await getSettings();
  if (!settings?.cartRecoveryEnabled) return;

  const customer = await findCustomerById(customerId);
  if (!customer) return;

  await upsertActiveCart(customerId, customer.email, settings.currency, lines);
}

/** Called when a checkout actually completes, so a stale reminder never goes out. */
export async function markCheckoutRecovered(customerId: string): Promise<void> {
  await markActiveCartRecovered(customerId);
}

/**
 * The cart's lines, with any design that has since been cleaned up dropped.
 * Prices are not stored on the cart: the postcard price is read from
 * settings at send time, exactly as checkout reads it.
 */
async function resolveLines(lines: CartLine[]): Promise<{ kept: CartLine[]; dropped: number }> {
  const designs = await findDesignsByIds(lines.flatMap((line) => line.designs.map((d) => d.designId)));
  const known = new Set(designs.map((d) => d.id));

  let dropped = 0;
  const kept: CartLine[] = [];

  for (const line of lines) {
    const designs = line.designs.filter((d) => known.has(d.designId));
    dropped += line.designs.length - designs.length;
    if (designs.length > 0) kept.push({ ...line, designs });
  }

  return { kept, dropped };
}

async function sendReminder(cart: CartRow): Promise<void> {
  const settings = await getSettings();
  const locale = settings?.locale ?? "en-US";
  const unitPriceCents = settings?.postcardPriceCents ?? 0;

  const recoveryToken = randomBytes(32).toString("base64url");
  const unsubscribeToken = randomBytes(32).toString("base64url");

  const claimed = await claimReminder(cart.id, hashToken(recoveryToken));
  if (!claimed) return;

  await setCartRecoveryUnsubscribeTokenHash(cart.customerId, hashToken(unsubscribeToken));

  const { kept, dropped } = await resolveLines(cart.lines);
  if (kept.length === 0) return;

  const items = kept.map((line) => {
    const count = countPostcards([line]);
    return {
      summary: `${line.designs.length} design${line.designs.length === 1 ? "" : "s"} to ${line.recipients.length} recipient${line.recipients.length === 1 ? "" : "s"}`,
      count,
      lineTotal: formatMoney(count * unitPriceCents, cart.currency, locale),
    };
  });

  const recoverUrl = new URL(`/cart?recover=${recoveryToken}`, env.PUBLIC_URL).toString();
  const unsubscribeUrl = new URL(`/unsubscribe?token=${unsubscribeToken}`, env.PUBLIC_URL).toString();

  await sendCartRecoveryEmail(cart.email, {
    items,
    subtotal: formatMoney(countPostcards(kept) * unitPriceCents, cart.currency, locale),
    droppedCount: dropped,
    recoverUrl,
    unsubscribeUrl,
  });
}

/** The scheduled sweep — one reminder per eligible cart past the configured delay. */
export async function runCartRecoverySweep(): Promise<void> {
  const settings = await getSettings();
  if (!settings?.cartRecoveryEnabled) return;

  const cutoff = new Date(Date.now() - settings.cartRecoveryDelayHours * 60 * 60 * 1000);
  const due = await findCartsDueForReminder(cutoff, 50);

  for (const cart of due) {
    try {
      await sendReminder(cart);
    } catch (error) {
      console.error(`Could not send a cart recovery reminder (cart ${cart.id}):`, error);
    }
  }
}

/** The scheduler: a `setInterval` in the API process, unref'd. */
export function startCartRecoveryScheduler(): { close: () => void } {
  const timer = setInterval(() => void runCartRecoverySweep(), SWEEP_INTERVAL_MS);
  timer.unref();
  return { close: () => clearInterval(timer) };
}

/**
 * Rebuild the cart an order was made from, batch by batch. `batchIndex` is
 * kept on every postcard row for exactly this: without it an expired checkout
 * for two batches would come back as one big one.
 */
export function linesFromOrder(order: Order): CartLine[] {
  const batches = new Map<number, Order["postcards"]>();
  for (const postcard of order.postcards) {
    const list = batches.get(postcard.batchIndex);
    if (list) list.push(postcard);
    else batches.set(postcard.batchIndex, [postcard]);
  }

  return [...batches.entries()]
    .sort(([a], [b]) => a - b)
    // A reply's recipient is the other card's sender, whose address the
    // order never carried in the open. That batch can't be rebuilt into a cart.
    .filter(([, postcards]) => !postcards.some((p) => p.isReply))
    .map(([, postcards]) => {
      const designs = new Map<string, { designId: string; mailDate: string }>();
      const recipients = new Map<string, Order["postcards"][number]["recipient"]>();
      for (const p of postcards) {
        designs.set(`${p.designId}|${p.mailDate}`, { designId: p.designId, mailDate: p.mailDate });
        recipients.set(`${p.recipient.name}|${formatRecipient(p.recipient)}`, p.recipient);
      }
      return {
        designs: [...designs.values()],
        recipients: [...recipients.values()],
        replyLink: postcards.some((p) => p.replyCode !== null),
        replyTo: null,
        replyToName: null,
      };
    });
}

/**
 * Salvage the highest-intent abandonment signal: a checkout that reached
 * Stripe and expired there. Gated on the same setting as everything else.
 */
export async function notifyCheckoutExpired(customerId: string, order: Order): Promise<void> {
  const settings = await getSettings();
  if (!settings?.cartRecoveryEnabled) return;

  const customer = await findCustomerById(customerId);
  if (!customer || customer.emailVerifiedAt == null) return;

  const lines = linesFromOrder(order);
  if (lines.length === 0) return;

  const cart = await upsertActiveCart(customerId, customer.email, order.currency, lines);
  if (cart) await sendReminder(cart);
}

/** Redeem a `/cart?recover=` link. Single-use, 7-day expiry. */
export async function recoverCart(token: string): Promise<CartLine[]> {
  const tokenHash = hashToken(token);
  const cart = await findCartByRecoveryTokenHash(tokenHash);
  if (!cart) throw new CartTokenNotUsableError("That recovery link is not valid.");

  const mintedAt = toEpochMs(cart.reminderSentAt) ?? 0;
  if (mintedAt + RECOVERY_TOKEN_TTL_MS < Date.now()) {
    throw new CartTokenNotUsableError("That recovery link has expired.");
  }

  const redeemed = await redeemRecoveryToken(cart.id, tokenHash);
  if (!redeemed) throw new CartTokenNotUsableError("That recovery link has already been used.");

  const { kept } = await resolveLines(cart.lines);
  return kept;
}

/** Redeem an unsubscribe link. Idempotent — clicking it twice only ever opts out. */
export async function unsubscribeFromCartRecovery(token: string): Promise<void> {
  await optOutOfCartRecoveryByTokenHash(hashToken(token));
}
