import { randomBytes } from "node:crypto";
import type { CartLine } from "../shared/cart.js";
import type { Order } from "../shared/orders.js";
import { formatMoney } from "../shared/money.js";
import { getSettings, listProducts } from "../db/repository.js";
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
 * Cart persistence, the recovery email, and the sweep that sends it — see
 * docs/tasks/12-abandoned-cart.md.
 *
 * Only ever acts for a signed-in customer with a verified, non-suppressed
 * email — a guest cart never reaches the server before checkout, so there is
 * no address to contact and nothing worth storing. The verified/opted-out
 * gate lives in `findCartsDueForReminder`'s query, not here.
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

/**
 * Sync a signed-in customer's cart.
 *
 * A no-op while the feature is off — "off by default" means nothing is
 * persisted, not just that no email goes out.
 */
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
 * Resolve a cart's stored lines against the live catalogue and send the one
 * reminder — or send nothing if another instance already claimed it.
 *
 * Claiming happens before any of the (slower) catalogue lookup or rendering
 * work, so a lost race costs one UPDATE, not a wasted email render.
 */
async function sendReminder(cart: CartRow): Promise<void> {
  // The store's language, so the reminder's prices match the shop the buyer
  // left — the cart page they are being sent back to formats them the same way.
  const locale = (await getSettings())?.locale ?? "en-US";
  const recoveryToken = randomBytes(32).toString("base64url");
  const unsubscribeToken = randomBytes(32).toString("base64url");

  const claimed = await claimReminder(cart.id, hashToken(recoveryToken));
  if (!claimed) return;

  await setCartRecoveryUnsubscribeTokenHash(cart.customerId, hashToken(unsubscribeToken));

  const { products } = await listProducts({ liveOnly: true, limit: 200 });
  const byId = new Map(products.map((p) => [p.id, p]));

  let subtotalCents = 0;
  let droppedCount = 0;
  const items: { productName: string; variantLabel: string; optionsText: string; quantity: number; lineTotal: string }[] =
    [];

  for (const line of cart.lines) {
    const product = byId.get(line.productId);
    const variant = product?.variants.find((v) => v.id === line.variantId);
    if (!product || !variant) {
      droppedCount += 1;
      continue;
    }

    subtotalCents += variant.priceCents * line.quantity;
    items.push({
      productName: product.name,
      variantLabel: variant.label,
      optionsText: Object.entries(line.options)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", "),
      quantity: line.quantity,
      lineTotal: formatMoney(variant.priceCents * line.quantity, cart.currency, locale),
    });
  }

  // Everything in the cart is gone — the token is already claimed (so this
  // cart is never re-selected), but there is nothing left worth emailing about.
  if (items.length === 0) return;

  const recoverUrl = new URL(`/cart?recover=${recoveryToken}`, env.PUBLIC_URL).toString();
  const unsubscribeUrl = new URL(`/unsubscribe?token=${unsubscribeToken}`, env.PUBLIC_URL).toString();

  await sendCartRecoveryEmail(cart.email, {
    items,
    subtotal: formatMoney(subtotalCents, cart.currency, locale),
    droppedCount,
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
      // One failed send must not stop the rest of the sweep.
      console.error(`Could not send a cart recovery reminder (cart ${cart.id}):`, error);
    }
  }
}

/**
 * The scheduler.
 *
 * A `setInterval` in the API process, same shape as `DrizzleSessionStore`'s
 * prune timer in server/session-store.ts — simplest option for a project
 * whose selling point is that SQLite is just a file, and honest about running
 * per-process. What makes two instances safe is not this timer (each instance
 * runs its own) but `claimReminder`'s conditional update: only the first of
 * two racing claims on the same cart can ever win, so duplicate ticks across
 * instances cost a wasted query, never a duplicate email.
 */
export function startCartRecoveryScheduler(): { close: () => void } {
  const timer = setInterval(() => void runCartRecoverySweep(), SWEEP_INTERVAL_MS);
  timer.unref();
  return { close: () => clearInterval(timer) };
}

/**
 * Salvage the highest-intent abandonment signal: a checkout that reached
 * Stripe and expired there. Sends immediately rather than waiting for the
 * delay, since intent is already proven — but goes through the same
 * `sendReminder`/`claimReminder` path, so a cart that already got its one
 * reminder (from the sweep, or an earlier expired session) does not get a
 * second one.
 *
 * Gated on the same setting as `syncCart` and `runCartRecoverySweep`. This is
 * the one entry point the merchant does not trigger — Stripe does, on its own
 * schedule — so without the gate an opted-out store would still persist a cart
 * row and send mail from its own SMTP the first time a checkout expired.
 */
export async function notifyCheckoutExpired(customerId: string, order: Order): Promise<void> {
  const settings = await getSettings();
  if (!settings?.cartRecoveryEnabled) return;

  const customer = await findCustomerById(customerId);
  if (!customer || customer.emailVerifiedAt == null) return;

  const lines: CartLine[] = order.items
    .filter((item): item is typeof item & { productId: string; variantId: string } =>
      Boolean(item.productId && item.variantId),
    )
    .map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      options: item.options,
    }));

  if (lines.length === 0) return;

  const cart = await upsertActiveCart(customerId, customer.email, order.currency, lines);
  if (cart) await sendReminder(cart);
}

/** Redeem a `/cart?recover=` link. Single-use, 7-day expiry, same as the account tokens. */
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

  return cart.lines;
}

/** Redeem an unsubscribe link. Idempotent — clicking it twice only ever opts out. */
export async function unsubscribeFromCartRecovery(token: string): Promise<void> {
  await optOutOfCartRecoveryByTokenHash(hashToken(token));
}
