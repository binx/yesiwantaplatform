import { useEffect } from "react";
import { useStore } from "./useStore";

/**
 * Name the page in the tab, the history and the bookmark.
 *
 * The production HTML handler already writes `Canvas Tote · Store` into
 * `<title>` for the path being requested (`server/seo.ts`). Then React boots,
 * and until this existed the shell's `DocumentTitle` set `document.title` to
 * the bare store name on every route — undoing the server's work on hydration,
 * so every tab, every bookmark and every history entry read alike.
 *
 * `name · store` is the same shape `server/seo.ts` produces, on purpose: the
 * head a crawler reads and the title a person sees must not be two different
 * answers.
 *
 * Pass `null` while the page's own subject is still loading, and the shell's
 * default is left in place rather than the tab flashing "undefined · Store".
 */
export function useDocumentTitle(name: string | null | undefined): void {
  const store = useStore();

  useEffect(() => {
    if (!name) return;
    document.title = `${name} · ${store.name}`;
  }, [name, store.name]);
}
