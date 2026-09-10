import type { PostcardStatus } from "@shared/postcards";

/** "Sep 14, 2026", in the store's language, for a YYYY-MM-DD mail date. */
export function formatMailDate(isoDate: string, locale: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** What a buyer is told about a card. Never Lob's error text — that is the admin's. */
export function customerStatusLabel(status: PostcardStatus): string {
  switch (status) {
    case "pending":
      return "Awaiting payment";
    case "scheduled":
      return "Scheduled";
    case "sending":
      return "Going to print";
    case "sent":
      return "Mailed";
    case "error":
      return "Needs attention";
    case "cancelled":
      return "Cancelled";
  }
}

/** What a scan is called on the page. Never Lob's own type string. */
export function trackingLabel(type: string): string {
  switch (type) {
    case "postcard.international_exit":
      return "Left the country";
    case "postcard.in_transit":
      return "In transit";
    case "postcard.in_local_area":
      return "Near its destination";
    case "postcard.processed_for_delivery":
      return "Out for delivery";
    case "postcard.delivered":
      return "Delivered";
    case "postcard.re-routed":
      return "Re-routed";
    case "postcard.returned_to_sender":
      return "Returned to sender — check the address";
    default:
      return type.replace(/^postcard\./, "").replaceAll("_", " ");
  }
}
