import { ARTIST_LINK_KINDS, artistLinkSchema, INSTAGRAM_HANDLE, instagramHandle, instagramUrl, withScheme, type ArtistLink, type ArtistLinkKind, type ArtistVisibility } from "@shared/platform";
import type { Image } from "@shared/schema";

/**
 * One link as the form holds it. Every kind's field is kept, so changing
 * the kind and back loses nothing typed; only the chosen kind's fields
 * make it into the link.
 */
export interface LinkDraft {
  kind: ArtistLinkKind;
  label: string;
  url: string;
  handle: string;
}

/** The profile as the forms hold it: what the artist typed, before the schema has seen it. */
export interface ProfileDraft {
  slug: string;
  name: string;
  bio: string;
  visibility: ArtistVisibility;
  avatar: Image | null;
  banner: Image | null;
  links: LinkDraft[];
}

export type SetDraft = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => void;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Stored links, back into rows: an Instagram link's username is read out of its address. */
export function linkDrafts(links: ArtistLink[]): LinkDraft[] {
  return links.map((link) => ({ kind: link.kind, label: link.label, url: link.url, handle: link.kind === "instagram" ? instagramHandle(link.url) : "" }));
}

/** A fresh row. The first kind nobody has used yet: a website, then Instagram, then whatever else. */
export function newLinkDraft(existing: LinkDraft[]): LinkDraft {
  const kind = ARTIST_LINK_KINDS.find((candidate) => !existing.some((link) => link.kind === candidate)) ?? "custom";
  return { kind, label: "", url: "", handle: "" };
}

/** Whether anything has been typed into the row's own fields. An untouched row is not a link. */
export function linkTyped(draft: LinkDraft): boolean {
  switch (draft.kind) {
    case "website":
      return draft.url.trim() !== "";
    case "instagram":
      return draft.handle.trim() !== "";
    case "custom":
      return draft.url.trim() !== "" || draft.label.trim() !== "";
  }
}

/** The link a row describes, as it would be stored. A missing scheme is supplied, not refused. */
export function linkOf(draft: LinkDraft): ArtistLink {
  switch (draft.kind) {
    case "website":
      return { kind: "website", label: "", url: withScheme(draft.url) };
    case "instagram":
      return { kind: "instagram", label: "", url: instagramUrl(instagramHandle(draft.handle)) };
    case "custom":
      return { kind: "custom", label: draft.label.trim(), url: withScheme(draft.url) };
  }
}

/** What is wrong with a row, in one sentence, or null while nothing is typed or it is fine. */
export function linkProblem(draft: LinkDraft): string | null {
  if (!linkTyped(draft)) return null;
  if (draft.kind === "instagram") {
    return INSTAGRAM_HANDLE.test(instagramHandle(draft.handle)) ? null : "Instagram usernames are letters, numbers, periods and underscores.";
  }
  if (draft.url.trim() === "") return "Add the address.";
  const parsed = artistLinkSchema.safeParse(linkOf(draft));
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check the link.");
}

/** The rows with something in them, as links. Rows the schema would refuse are included, so it can say why. */
export function typedLinks(links: LinkDraft[]): ArtistLink[] {
  return links.filter(linkTyped).map(linkOf);
}
