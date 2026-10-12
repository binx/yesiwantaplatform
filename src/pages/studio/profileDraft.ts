import type { ArtistLink, ArtistVisibility } from "@shared/platform";
import type { Image } from "@shared/schema";

/** The profile as the forms hold it: what the artist typed, before the schema has seen it. */
export interface ProfileDraft {
  slug: string;
  name: string;
  bio: string;
  visibility: ArtistVisibility;
  avatar: Image | null;
  banner: Image | null;
  links: ArtistLink[];
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

/** A row with nothing typed in it is not a link; one with a label and no address is a mistake the schema names. */
export function typedLinks(links: ArtistLink[]): ArtistLink[] {
  return links.filter((link) => link.url.trim() !== "" || link.label.trim() !== "");
}
