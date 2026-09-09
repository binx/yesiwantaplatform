import { Router, type Request } from "express";
import { getSettings, getStorefrontState, listSitemapEntries } from "../../db/repository.js";
import { env } from "../env.js";

/**
 * Whether *this request* should be told the store is locked.
 *
 * An administrator's own browser still gets the real files — there is no
 * reason to hide the sitemap from the person who can see the whole catalogue
 * in the admin anyway — but every other caller, crawlers included, sees the
 * locked answer for as long as the store is locked.
 */
async function isLocked(req: Request): Promise<boolean> {
  if (req.session.adminId) return false;
  const state = await getStorefrontState();
  return state !== null && state.access !== "public";
}

/**
 * Files crawlers look for at the site root.
 *
 * Mounted at `/`, not under `/api`, and deliberately before the SPA fallback in
 * `app.ts` — that fallback matches everything outside `/api`, so mounting this
 * after it would serve the HTML shell for both of these.
 */
export const siteRouter: Router = Router();

/** `&`, `<` and `'` are all legal in a slug and all break XML. */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function url(pathname: string, lastModified?: number): string {
  const loc = escapeXml(new URL(pathname, env.PUBLIC_URL).toString());
  const lastmod = lastModified
    ? `<lastmod>${new Date(lastModified).toISOString().slice(0, 10)}</lastmod>`
    : "";
  return `  <url><loc>${loc}</loc>${lastmod}</url>`;
}

siteRouter.get("/sitemap.xml", async (req, res) => {
  // The whole catalogue in one unauthenticated request is exactly what a
  // locked store must not answer with — see docs/tasks/27-storefront-preview-mode.md §4.
  if (await isLocked(req)) {
    res.status(404).type("text/plain").send("Not found.");
    return;
  }

  const [settings, entries] = await Promise.all([getSettings(), listSitemapEntries()]);

  const lines = [
    url("/"),
    url("/shop"),
    // Only when there is something to read there.
    ...(settings?.aboutText ? [url("/about")] : []),
    ...entries.map((entry) => url(entry.path, entry.lastModified)),
  ];

  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines.join("\n")}
</urlset>
`,
  );
});

siteRouter.get("/robots.txt", async (req, res) => {
  if (await isLocked(req)) {
    // No Sitemap: line — one does not exist to crawl while the store is
    // locked, and naming it would just be a second way to notice this store
    // is here before anyone means it to be found.
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
    return;
  }

  const sitemap = new URL("/sitemap.xml", env.PUBLIC_URL).toString();

  res.type("text/plain").send(
    `User-agent: *
Allow: /
Disallow: /admin
Disallow: /setup

Sitemap: ${sitemap}
`,
  );
});
