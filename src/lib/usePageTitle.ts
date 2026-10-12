import { useEffect } from "react";
import { SITE_TITLE } from "@shared/site";
import { useStore } from "./useStore";

/**
 * The tab's title: the page's subject, then the site's name — "Artists ·
 * Yes I Want A Postcard" — the same shape `server/seo.ts` gives the shell,
 * with the same name: the one in settings, or `SITE_TITLE` before it is set.
 *
 * Nothing (or an empty subject, while a page is still loading) is the bare
 * site name. The cleanup puts the bare name back, so a page that sets no
 * title never inherits the last one's.
 */
export function usePageTitle(subject?: string | null): void {
  const name = useStore().name || SITE_TITLE;
  useEffect(() => {
    document.title = subject ? `${subject} · ${name}` : SITE_TITLE;
    return () => {
      document.title = SITE_TITLE;
    };
  }, [subject, name]);
}
