import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { escapeHtml, injectMeta } from "./html.js";

/**
 * Metadata for a client-rendered storefront.
 *
 * The escaping tests are the load-bearing ones: product names are
 * merchant-supplied and land inside a `content="…"` attribute, and a
 * description containing `</script>` would otherwise break out of the JSON-LD
 * block.
 */

let app: Express;

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="A Beluga storefront." />
    <title>Beluga</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  app = createApp();
});

describe("escapeHtml", () => {
  it("escapes everything that can break out of an attribute", () => {
    expect(escapeHtml('Tote & "Bag" <3')).toBe("Tote &amp; &quot;Bag&quot; &lt;3");
    expect(escapeHtml("it's")).toBe("it&#39;s");
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes the ampersand first, so entities are not double-encoded wrong", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Canvas Tote")).toBe("Canvas Tote");
  });
});

describe("injectMeta", () => {
  it("replaces the title rather than adding a second one", () => {
    const html = injectMeta(SHELL, {
      title: "Canvas Tote · Beluga",
      description: "A bag.",
      canonical: "https://example.com/product/canvas-tote",
      image: null,
      jsonLd: null,
    });

    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain("<title>Canvas Tote · Beluga</title>");
    expect(html).not.toContain("A Beluga storefront.");
  });

  it("escapes a hostile product name into the attributes", () => {
    const html = injectMeta(SHELL, {
      title: 'Tote & "Bag" <3',
      description: 'Ends the attribute" onload="alert(1)',
      canonical: "https://example.com/",
      image: null,
      jsonLd: null,
    });

    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain("&quot;");
    expect(html).toContain("<title>Tote &amp; &quot;Bag&quot; &lt;3</title>");
  });

  it("adds the Open Graph and Twitter tags", () => {
    const html = injectMeta(SHELL, {
      title: "T",
      description: "D",
      canonical: "https://example.com/shop",
      image: "https://example.com/a.png",
      jsonLd: null,
    });

    expect(html).toContain('<meta property="og:title" content="T" />');
    expect(html).toContain('<meta property="og:image" content="https://example.com/a.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<link rel="canonical" href="https://example.com/shop" />');
  });

  it("cannot be broken out of by a description containing a closing script tag", () => {
    const html = injectMeta(SHELL, {
      title: "T",
      description: "D",
      canonical: "https://example.com/",
      image: null,
      jsonLd: { "@type": "Product", name: "</script><img onerror=alert(1)>" },
    });

    // One opening and one closing tag: the payload did not create a third.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script");
  });

  it("omits the image and JSON-LD when there are none", () => {
    const html = injectMeta(SHELL, {
      title: "T",
      description: "D",
      canonical: "https://example.com/",
      image: null,
      jsonLd: null,
    });

    expect(html).not.toContain("og:image");
    expect(html).not.toContain("ld+json");
  });
});

describe("metaForPath", () => {
  it("uses the store name at the root", async () => {
    const { metaForPath } = await import("./seo.js");
    const meta = await metaForPath("/");

    expect(meta.title).toBe("Beluga Demo");
    expect(meta.jsonLd).toBeNull();
  });

  it("names the section on /shop and /about", async () => {
    const { metaForPath } = await import("./seo.js");

    expect((await metaForPath("/shop")).title).toBe("Shop · Beluga Demo");
    expect((await metaForPath("/about")).title).toBe("About · Beluga Demo");
  });

  it("describes a product and emits an Offer", async () => {
    const { metaForPath } = await import("./seo.js");
    const meta = await metaForPath("/product/canvas-tote");

    expect(meta.title).toBe("Canvas Tote · Beluga Demo");
    expect(meta.description.length).toBeLessThanOrEqual(160);
    expect(meta.canonical).toMatch(/\/product\/canvas-tote$/);

    const jsonLd = meta.jsonLd as {
      "@type": string;
      offers: { price: string; priceCurrency: string; availability: string };
    };
    expect(jsonLd["@type"]).toBe("Product");
    // A bare decimal, not a formatted display string.
    expect(jsonLd.offers.price).toMatch(/^\d+\.\d{2}$/);
    expect(jsonLd.offers.availability).toMatch(/schema\.org\/(In|Out Of)?[A-Za-z]*Stock/);
  });

  it("names a collection", async () => {
    const { metaForPath } = await import("./seo.js");
    expect((await metaForPath("/collection/featured-products")).title).toBe(
      "Featured · Beluga Demo",
    );
  });

  it("falls back to the store defaults for anything unknown", async () => {
    const { metaForPath } = await import("./seo.js");

    // Bots probe nonsense URLs constantly; none of these may throw.
    for (const path of ["/product/nope", "/collection/nope", "/wat", "/product/%%%"]) {
      const meta = await metaForPath(path);
      expect(meta.title).toBe("Beluga Demo");
      expect(meta.jsonLd).toBeNull();
    }
  });
});

describe("crawler files", () => {
  it("serves a sitemap listing live products only", async () => {
    const { createProduct } = await import("../db/admin-repository.js");
    await createProduct({
      slug: "unlisted-draft",
      name: "Unlisted Draft",
      description: "",
      bulletPoints: [],
      seoTitle: null,
      seoDescription: null,
      variantName: null,
      taxCode: null,
      variants: [{ label: "", priceCents: 100, inventory: { type: "infinite" }, weightGrams: 0 }],
      optionGroups: [],
      isLive: false,
    });

    const response = await request(app).get("/sitemap.xml").expect(200);

    expect(response.headers["content-type"]).toMatch(/xml/);
    expect(response.text).toContain("/product/canvas-tote");
    // A draft is editable in the admin and invisible everywhere else, which
    // has to include the file telling crawlers what to index.
    expect(response.text).not.toContain("/product/unlisted-draft");
  });

  it("serves robots.txt pointing at the sitemap", async () => {
    const response = await request(app).get("/robots.txt").expect(200);

    expect(response.text).toContain("Disallow: /admin");
    expect(response.text).toContain("Disallow: /setup");
    expect(response.text).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  });
});
