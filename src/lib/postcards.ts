import type { SubscriptionStatus } from "@shared/platform";
import type { PostcardStatus as CardStatus } from "@shared/postcards";

/**
 * Words for states, in one place, so the account, the studio and the admin
 * cannot call the same thing three different names.
 */

/** "14 September 2026", in the platform's language. */
export function formatMailDate(isoDate: string, locale: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** "14 Sep", for tight tables. */
export function formatShortDate(isoDate: string, locale: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Epoch milliseconds as a day. */
export function formatDay(epochMs: number, locale: string): string {
  return new Date(epochMs).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}

/** What a subscriber or artist is told about a card. Lob's own words never reach them. */
export function customerStatusLabel(status: CardStatus): string {
  switch (status) {
    case "scheduled":
    case "sending":
      return "Going to print";
    case "sent":
      return "Mailed";
    case "error":
      return "We're looking into it";
    case "cancelled":
      return "Withdrawn";
  }
}

/** The admin's, which names the state. */
export function adminStatusLabel(status: CardStatus): string {
  switch (status) {
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

export function trackingLabel(type: string): string {
  switch (type) {
    case "postcard.international_exit":
      return "Left the country";
    case "postcard.in_transit":
      return "In transit";
    case "postcard.in_local_area":
      return "Near its destination";
    case "postcard.processed_for_delivery":
      return "At the local post office";
    case "postcard.re-routed":
      return "Re-routed";
    case "postcard.returned_to_sender":
      return "Returned to sender";
    case "postcard.delivered":
      return "Delivered";
    default:
      return type.replace(/^postcard\./, "").replace(/[_-]/g, " ");
  }
}

export function subscriptionStatusLabel(status: SubscriptionStatus, cancelAtPeriodEnd = false): string {
  if (status === "active" && cancelAtPeriodEnd) return "Ending soon";
  switch (status) {
    case "incomplete":
      return "Confirming";
    case "active":
      return "Active";
    case "past_due":
      return "Payment failed";
    case "cancelled":
      return "Cancelled";
  }
}
