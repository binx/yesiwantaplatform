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
