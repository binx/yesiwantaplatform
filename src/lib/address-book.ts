import type { CustomerAddress } from "@shared/account";
import { CSV_BOM, csvRow } from "@shared/csv";
import { formatRecipient } from "@shared/postcards";

/**
 * The address book, beside the API: searching it, and writing it out.
 */

/** Entries matching a typed query on name, label, city, tags or notes, and every chosen tag. */
export function filterAddresses(addresses: CustomerAddress[], query: string, tags: string[]): CustomerAddress[] {
  const needle = query.trim().toLowerCase();
  return addresses.filter((address) => {
    if (tags.some((tag) => !address.tags.includes(tag))) return false;
    if (needle === "") return true;
    const haystack = [address.name, address.label ?? "", address.city, address.line1, address.notes ?? "", ...address.tags].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

/** Every tag in use, most used first. */
export function allTags(addresses: CustomerAddress[]): string[] {
  const counts = new Map<string, number>();
  for (const address of addresses) for (const tag of address.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** "Oct 14", or "Oct 14, 1985" when the year is known. */
export function formatBirthday(birthday: string, locale: string): string {
  const withYear = /^\d{4}-/.test(birthday);
  const [y, m, d] = (withYear ? birthday : `2000-${birthday}`).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/**
 * The book as a CSV the designer's importer reads back: the sample file's
 * columns, then the book's own, which the importer ignores.
 */
export function addressBookCsv(addresses: CustomerAddress[]): string {
  const header = ["name", "address_line1", "address_line2", "address_city", "address_state", "address_zip", "country", "label", "tags", "birthday", "notes"];
  const rows = addresses.map((a) =>
    csvRow([a.name, a.line1, a.line2, a.city, a.state, a.postalCode, a.country, a.label, a.tags.join("|"), a.birthday, a.notes]),
  );
  return CSV_BOM + csvRow(header) + rows.join("");
}

/** One line for a list: the label when there is one, then the printed name. */
export function addressTitle(address: CustomerAddress): string {
  return address.label && address.label !== address.name ? `${address.label} · ${address.name}` : address.name;
}

export { formatRecipient };
