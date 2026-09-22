import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { CARD_FONTS_LINK_ID, CARD_FONTS_URL } from "../shared/postcards.js";
import { escapeHtml, injectMeta } from "./html.js";

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="A storefront." />
    <title>Yes I Want A Postcard</title>
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
      title: "Yes I Want A Postcard",
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
      "<title>Yes I Want A Postcard</title>",
      `<title>Yes I Want A Postcard</title>\n    <link id="${CARD_FONTS_LINK_ID}" rel="stylesheet" href="x" />`,
    );
    const html = injectMeta(shellWithCardFonts, {
      title: "Yes I Want A Postcard",
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
  it("names the platform at the root, the directory and the gallery, and a live artist's page", async () => {
    const { metaForPath } = await import("./seo.js");
    expect((await metaForPath("/")).title).toBe("Yes I Want A Postcard");
    expect((await metaForPath("/artists")).title).toBe("Artists · Yes I Want A Postcard");
    expect((await metaForPath("/gallery")).status).toBe(200);
    expect((await metaForPath("/for-artists")).title).toBe("For artists · Yes I Want A Postcard");

    const { createCustomer } = await import("./auth.js");
    const { createArtist, setArtistStatus } = await import("../db/artists-repository.js");
    const owner = await createCustomer("seo-artist@example.com", "a-sufficiently-long-password", "Rachel");
    const artist = await createArtist(owner, { slug: "seo-rachel", name: "Rachel", tagline: "photos from the road", bio: "", monthlyPriceCents: 500, sendDay: 15, visibility: "public", avatar: null });
    expect((await metaForPath("/a/seo-rachel")).status).toBe(404);
    await setArtistStatus(artist.id, "live");
    const page = await metaForPath("/a/seo-rachel");
    expect(page.status).toBe(200);
    expect(page.title).toBe("Rachel · Yes I Want A Postcard");
    expect(page.description).toBe("photos from the road");
    expect(page.jsonLd).toMatchObject({ "@type": "Person", name: "Rachel" });
  });

  it("calls an unknown page a 404 and keeps the client routes at 200", async () => {
    const { metaForPath } = await import("./seo.js");
    expect((await metaForPath("/no-such-page")).status).toBe(404);
    expect((await metaForPath("/a/no-such-artist")).status).toBe(404);
    for (const path of ["/", "/artists", "/gallery", "/for-artists", "/subscribe/confirm", "/studio", "/account/login"]) {
      expect((await metaForPath(path)).status).toBe(200);
    }
  });
});
