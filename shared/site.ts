/**
 * What every tab, bookmark, history entry and link unfurl calls this site.
 *
 * One word, everywhere: the shell's `<title>`, the server-rendered head
 * (`server/seo.ts`), and `document.title` after React boots all read this
 * and nothing else. A page's own subject is for the page, not the tab.
 */
export const SITE_TITLE = "yesiwantapostcard";
