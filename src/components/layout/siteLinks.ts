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
 * hero draws it itself, so the two cannot disagree about what the account
 * link is called.
 *
 * "Open a studio" is the pitch, and it stays in the navigation for an artist
 * too: the page is where the process and the money are explained, and its
 * button takes a signed-in artist to their studio. The studio itself is
 * reached from the account.
 */
export function useSiteLinks(): { links: SiteLink[]; accountHref: string; accountLabel: string } {
  const store = useStore();
  const customer = useCustomer();

  const links: SiteLink[] = [
    { to: "/artists", label: "Artists" },
    { to: "/gallery", label: "Gallery" },
    ...store.pages.filter((page) => page.inNav).map((page) => ({ to: `/${page.slug}`, label: page.title })),
    { to: "/open-a-studio", label: "Open a studio" },
  ];

  return {
    links,
    accountHref: customer.data ? "/account" : "/account/login",
    accountLabel: customer.data ? "Your account" : "Sign in",
  };
}
