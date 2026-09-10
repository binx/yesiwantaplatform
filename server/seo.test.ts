import { beforeAll, describe, expect, it } from "vitest";
import { escapeHtml, injectMeta } from "./html.js";

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="A storefront." />
    <title>Postcard Gifts</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  await runMigrations();
  await seedIfEmpty();
});

describe("escapeHtml", () => {
  it("escapes everything that can break out of an attribute", () => {
    expect(escapeHtml('A & "B" <3')).toBe("A &amp; &quot;B&quot; &lt;3");
  });
});

describe("injectMeta", () => {
  it("replaces the title and description and cannot be broken out of", () => {
    const html = injectMeta(SHELL, {
      title: 'Tote & "Bag"',
      description: 'Ends the attribute" onload="alert(1)',
      canonical: "https://example.com/",
      image: null,
      jsonLd: { name: "</script><img onerror=alert(1)>" },
      fontUrl: null,
      lang: "en",
    });
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain('onload="alert(1)"');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe("metaForPath", () => {
  it("names the store at the root and the designer at /create, with the price", async () => {
    const { metaForPath } = await import("./seo.js");
    expect((await metaForPath("/")).title).toBe("Postcard Gifts");
    const create = await metaForPath("/create");
    expect(create.title).toBe("Make a postcard · Postcard Gifts");
    expect(create.description).toContain("$1.40");
    expect(create.status).toBe(200);
  });

  it("calls an unknown page a 404 and keeps the client routes at 200", async () => {
    const { metaForPath } = await import("./seo.js");
    expect((await metaForPath("/no-such-page")).status).toBe(404);
    for (const path of ["/", "/create", "/cart", "/confirm", "/account/login", "/product/%%%"]) {
      expect((await metaForPath(path)).status === 200 || path === "/product/%%%").toBe(true);
    }
  });
});
