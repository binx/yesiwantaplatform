import { useStore } from "@/lib/useStore";
import { useCustomer } from "@/lib/account";

export interface SiteLink {
  to: string;
  label: string;
}

/**
 * The site's main navigation, computed once for whoever draws it.
 *
 * The `Banner` draws it on every page but the front one; the front page's
 * hero draws it itself, so the two cannot disagree about whether a signed-in
 * artist sees "Your studio" or what the account link is called.
 */
export function useSiteLinks(): { links: SiteLink[]; accountHref: string; accountLabel: string } {
  const store = useStore();
  const customer = useCustomer();

  const links: SiteLink[] = [
    { to: "/artists", label: "Artists" },
    { to: "/gallery", label: "Gallery" },
    ...store.pages.filter((page) => page.inNav).map((page) => ({ to: `/${page.slug}`, label: page.title })),
    { to: "/how-it-works", label: "How it works" },
    // The studio is where an artist works, shown only to someone who has one.
    ...(customer.data?.artistSlug ? [{ to: "/studio", label: "Your studio" }] : []),
  ];

  return {
    links,
    accountHref: customer.data ? "/account" : "/account/login",
    accountLabel: customer.data ? "Your account" : "Sign in",
  };
}
