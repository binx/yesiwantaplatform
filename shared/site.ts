/**
 * What every tab, bookmark, history entry and link unfurl calls this site.
 *
 * One word, everywhere: the shell's `<title>`, the server-rendered head
 * (`server/seo.ts`), and `document.title` after React boots all end with
 * this. A page with a subject of its own puts it first — "Artists ·
 * yesiwantapostcard" — through `usePageTitle` on the client and `seo.ts`
 * on the server, so a tab, a bookmark and a link unfurl all say which page.
 */
export const SITE_TITLE = "yesiwantapostcard";
