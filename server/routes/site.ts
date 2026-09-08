import { Router } from "express";
import { getSettings, listSitemapEntries } from "../../db/repository.js";
import { env } from "../env.js";

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

siteRouter.get("/sitemap.xml", async (_req, res) => {
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

siteRouter.get("/robots.txt", (_req, res) => {
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
