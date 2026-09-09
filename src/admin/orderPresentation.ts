import type { OrderStatus } from "@shared/orders";

/**
 * How an order is rendered, in one place.
 *
 * Three v1 bugs lived in this area and all three were presentation code:
 *
 *   - the orders admin called `charAt` on a status that could be undefined,
 *     which threw during render and white-screened the whole page (finding 3);
 *   - dates came out a month early, from building a `Date` out of a 1-based
 *     month and passing it to a 0-based constructor (finding 55);
 *   - a missing status rendered as an empty badge with no indication that
 *     anything was wrong.
 *
 * So: every lookup here is total, and nothing is derived by string surgery.
 * The badge itself lives in `OrderStatusTag`.
 */

export const STATUS_LABELS: Record<OrderStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "default" },
  paid: { label: "Paid", color: "green" },
  processing: { label: "Processing", color: "blue" },
  shipped: { label: "Shipped", color: "cyan" },
  cancelled: { label: "Cancelled", color: "default" },
  refunded: { label: "Refunded", color: "orange" },
};

export const ORDER_STATUSES = Object.keys(STATUS_LABELS) as OrderStatus[];

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as OrderStatus]?.label ?? status ?? "Unknown";
}

/**
 * Epoch milliseconds to a readable date, in the store's language.
 *
 * Formatted through Intl rather than assembled from `getMonth()` and friends,
 * which is where v1's off-by-one month came from.
 *
 * `locale` used to be `undefined`, meaning the browser's — so the same order
 * showed a different date to a merchant in Berlin than to their colleague in
 * Boston, and neither matched the emailed confirmation. The store picks one,
 * the way it picks one currency.
 */
export function formatOrderDate(epochMs: number, withTime = false, locale = "en-US"): string {
  if (!Number.isFinite(epochMs)) return "—";

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(new Date(epochMs));
}
