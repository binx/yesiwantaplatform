import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { CARD_FONTS_LINK_ID, CARD_FONTS_URL } from "../shared/postcards.js";
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

  it("loads the card fonts whether or not the store has a theme font", () => {
    const meta = {
      title: "Postcard Gifts",
      description: "A storefront.",
      canonical: "https://example.com/",
      image: null,
      jsonLd: null,
      lang: "en",
    };
    for (const fontUrl of [null, "https://fonts.googleapis.com/css2?family=Fraunces"]) {
      const html = injectMeta(SHELL, { ...meta, fontUrl });
      expect(html).toContain(CARD_FONTS_LINK_ID);
      expect(html).toContain(CARD_FONTS_URL.replaceAll("&", "&amp;"));
    }
  });

  it("does not add a second card-fonts link when the shell already carries one", () => {
    const shellWithCardFonts = SHELL.replace(
      "<title>Postcard Gifts</title>",
      `<title>Postcard Gifts</title>\n    <link id="${CARD_FONTS_LINK_ID}" rel="stylesheet" href="x" />`,
    );
    const html = injectMeta(shellWithCardFonts, {
      title: "Postcard Gifts",
      description: "A storefront.",
      canonical: "https://example.com/",
      image: null,
      jsonLd: null,
      fontUrl: null,
      lang: "en",
    });
    expect(html.match(new RegExp(CARD_FONTS_LINK_ID, "g"))).toHaveLength(1);
  });
});

describe("index.html", () => {
  it("carries the same card-fonts link server/html.ts builds, so dev matches production", () => {
    const source = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(source).toContain(CARD_FONTS_LINK_ID);
    expect(source).toContain(CARD_FONTS_URL);
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
