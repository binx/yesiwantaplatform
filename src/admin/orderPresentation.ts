import type { OrderFilter, OrderStatus } from "@shared/orders";
import type { PostcardStatus } from "@shared/postcards";

/** Every status, in the order the filter shows them. */
export const ORDER_STATUSES: OrderStatus[] = ["pending", "paid", "completed", "cancelled", "refunded"];

/** The filter chips, in the order the list shows them. "Returned" sits last: it is a different question. */
export const ORDER_FILTERS: OrderFilter[] = ["all", ...ORDER_STATUSES, "returned"];

/** What a chip is called, and — for the empty state — what the list was looking for. */
export function filterLabel(filter: OrderFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "returned":
      return "Returned";
    default:
      return statusLabel(filter);
  }
}

export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "paid":
      return "In progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "refunded":
      return "Refunded";
  }
}

export function postcardStatusLabel(status: PostcardStatus): string {
  switch (status) {
    case "pending":
      return "Unpaid";
    case "scheduled":
      return "Scheduled";
    case "sending":
      return "Sending";
    case "sent":
      return "Sent to Lob";
    case "error":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

/** An order's date, with the time when it is the detail page asking. */
export function formatOrderDate(epochMs: number, withTime: boolean, locale: string): string {
  return new Date(epochMs).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
