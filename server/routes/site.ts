import { Router } from "express";
import { listPageSummaries } from "../../db/pages-repository.js";
import { env } from "../env.js";

/**
 * Files crawlers look for at the site root.
 *
 * Mounted at `/`, not under `/api`, and deliberately before the SPA fallback in
 * `app.ts` — that fallback matches everything outside `/api`.
 */
export const siteRouter: Router = Router();

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function url(pathname: string): string {
  return `  <url><loc>${escapeXml(new URL(pathname, env.PUBLIC_URL).toString())}</loc></url>`;
}

siteRouter.get("/sitemap.xml", async (_req, res) => {
  const pages = await listPageSummaries({ liveOnly: true });

  const lines = [url("/"), url("/create"), ...pages.map((page) => url(`/${page.slug}`))];

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
Disallow: /account
Disallow: /cart
Disallow: /confirm

Sitemap: ${sitemap}
`,
  );
});
