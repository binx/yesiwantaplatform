import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Web fonts, and the header that decides whether one ever loads.
 *
 * The feature is two halves that have to agree: a `fontUrl` on the theme, and
 * a Content-Security-Policy wide enough for the browser to fetch it. Either
 * half alone is worse than neither — a URL the CSP refuses is a font that
 * silently does not appear, which is exactly the bug this replaced.
 *
 * So the assertions here are about the header, not about the column: that a
 * store with no font gets *byte-for-byte* the policy it had before any of this
 * existed, and that a store with one gets that policy plus the two origins its
 * stylesheet actually needs — Google's `fonts.googleapis.com` for the sheet and
 * `fonts.gstatic.com` for the files, the second of which appears nowhere in
 * what the merchant pasted.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

const GOOGLE_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces&display=swap";

/** What `css2` answers a browser: `@font-face` rules pointing at gstatic. */
const GOOGLE_CSS_BODY = `
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/fraunces/v31/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIctxujDvTShUtWNg.woff2) format('woff2');
}
`;

/** The exact policy a store with no font URL must keep serving. */
const BASELINE_STYLE_SRC = "style-src 'self' 'unsafe-inline'";
const BASELINE_FONT_SRC = "font-src 'self' data:";

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("fonts-admin@example.com", PASSWORD);

  app = createApp();
});

beforeEach(async () => {
  const { resetFontOrigins } = await import("./fonts.js");
  resetFontOrigins();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answer every stylesheet fetch with Google's CSS, and count the calls. */
function stubGoogleFonts() {
  const fetchMock = vi.fn(() => {
    const response = new Response(GOOGLE_CSS_BODY, { status: 200 });
    // `url` is read-only on a constructed Response, and the resolver reads it
    // to follow redirects — so it is defined here rather than passed in.
    Object.defineProperty(response, "url", { value: GOOGLE_CSS_URL });
    return Promise.resolve(response);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "fonts-admin@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

/** The saved settings, with `theme.fontUrl` replaced. */
async function saveFontUrl(fontUrl: string | null) {
  const { agent, csrf } = await signIn();
  const current = await agent.get("/api/admin/settings").expect(200);

  return agent
    .put("/api/admin/settings")
    .set("x-csrf-token", csrf)
    .send({ ...current.body, theme: { ...current.body.theme, fontUrl } });
}

function cspOf(headers: Record<string, string | undefined>): string {
  return headers["content-security-policy"] ?? "";
}

describe("the Content-Security-Policy", () => {
  it("is unchanged when the store has no font URL", async () => {
    await saveFontUrl(null).then((res) => expect(res.status).toBe(204));

    const response = await request(app).get("/api/health").expect(200);
    const csp = cspOf(response.headers);

    // Byte-for-byte: the directives end at the next `;`, so an extra origin
    // anywhere in either one fails this rather than merely looking different.
    expect(csp).toContain(`${BASELINE_STYLE_SRC};`);
    expect(csp).toContain(`${BASELINE_FONT_SRC};`);
  });

  it("carries the stylesheet origin and the font file origin when one is set", async () => {
    stubGoogleFonts();
    await saveFontUrl(GOOGLE_CSS_URL).then((res) =>
      expect(res.status).toBe(204),
    );

    const response = await request(app).get("/api/health").expect(200);
    const csp = cspOf(response.headers);

    // Both, and this is the whole point of fetching the sheet: gstatic is
    // named nowhere in the URL the merchant pasted.
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    );
    expect(csp).toContain(
      "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com",
    );
  });

  it("adds nothing beyond those two origins", async () => {
    stubGoogleFonts();
    await saveFontUrl(GOOGLE_CSS_URL).then((res) =>
      expect(res.status).toBe(204),
    );

    const response = await request(app).get("/api/health").expect(200);
    const styleSrc =
      /style-src ([^;]*)/.exec(cspOf(response.headers))?.[1] ?? "";

    expect(styleSrc.split(" ").filter(Boolean)).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ]);
  });

  it("narrows again when the font URL is cleared", async () => {
    stubGoogleFonts();
    await saveFontUrl(GOOGLE_CSS_URL).then((res) =>
      expect(res.status).toBe(204),
    );

    // Back to a system font: the store should stop advertising a third party
    // it no longer uses.
    await saveFontUrl(null).then((res) => expect(res.status).toBe(204));

    const csp = cspOf(
      (await request(app).get("/api/health").expect(200)).headers,
    );
    expect(csp).toContain(`${BASELINE_STYLE_SRC};`);
    expect(csp).not.toContain("fonts.gstatic.com");
  });

  it("does not widen for a self-hosted stylesheet, which 'self' already covers", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await saveFontUrl("/assets/fonts/inter.css").then((res) =>
      expect(res.status).toBe(204),
    );

    const csp = cspOf(
      (await request(app).get("/api/health").expect(200)).headers,
    );

    expect(csp).toContain(`${BASELINE_STYLE_SRC};`);
    // Nor should it have gone looking: the server would be asking itself.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("saving a font URL", () => {
  it("refuses a stylesheet that cannot be fetched, and names it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    const broken = "https://fonts.example.com/css2?family=Nope";
    const response = await saveFontUrl(broken);

    expect(response.status).toBe(422);
    // Naming the URL is the point: "invalid font" tells a merchant who pasted
    // a long Google href nothing about which part of it is wrong.
    expect(response.body.error).toContain(broken);
  });

  it("refuses a stylesheet that answers an error status, and names it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not found", { status: 404 }))),
    );

    const missing = "https://fonts.googleapis.com/css2?family=Typo";
    const response = await saveFontUrl(missing);

    expect(response.status).toBe(422);
    expect(response.body.error).toContain(missing);
    expect(response.body.error).toContain("404");
  });

  it("refuses a plain http:// address without fetching it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await saveFontUrl("http://fonts.example.com/f.css");

    /*
     * 400, not the 422 an unreachable stylesheet gets: this never reaches the
     * resolver at all. `fontUrlSchema` refuses it while the body is being
     * parsed, which is the right place — a store on https must not pull a
     * subresource over a channel anyone can rewrite, and that is knowable
     * without asking the network.
     */
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves the saved value alone when the fetch fails", async () => {
    stubGoogleFonts();
    await saveFontUrl(GOOGLE_CSS_URL).then((res) =>
      expect(res.status).toBe(204),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    await saveFontUrl("https://fonts.example.com/broken.css").then((res) =>
      expect(res.status).toBe(422),
    );

    // Validation runs before the write, so a refused save is not a half-save
    // that leaves the store pointing at a stylesheet that never arrives.
    const { getSettings } = await import("../db/repository.js");
    expect((await getSettings())?.theme.fontUrl).toBe(GOOGLE_CSS_URL);
  });

  it("fetches a given stylesheet once, however many saves name it", async () => {
    const fetchSpy = stubGoogleFonts();

    await saveFontUrl(GOOGLE_CSS_URL).then((res) =>
      expect(res.status).toBe(204),
    );
    await saveFontUrl(GOOGLE_CSS_URL).then((res) =>
      expect(res.status).toBe(204),
    );

    // Cached per URL — a settings save should not cost a round trip to a third
    // party every time the merchant changes an unrelated field.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("resolveFontOrigins", () => {
  it("ignores data: faces, which fontSrc already allows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        const response = new Response(
          "@font-face { src: url(data:font/woff2;base64,AAAA) format('woff2'); }",
          { status: 200 },
        );
        Object.defineProperty(response, "url", {
          value: "https://example.com/f.css",
        });
        return Promise.resolve(response);
      }),
    );

    const { resolveFontOrigins } = await import("./fonts.js");
    const origins = await resolveFontOrigins("https://example.com/f.css");

    expect(origins).toEqual(["https://example.com"]);
  });

  it("resolves a relative url() against the stylesheet it came from", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        const response = new Response(
          "@font-face { src: url(../files/inter.woff2); }",
          {
            status: 200,
          },
        );
        Object.defineProperty(response, "url", {
          value: "https://cdn.example.com/css/inter.css",
        });
        return Promise.resolve(response);
      }),
    );

    const { resolveFontOrigins } = await import("./fonts.js");

    // Same origin as the sheet here, so the set collapses to one — the
    // assertion is that a relative reference does not become a second, wrong
    // origin or get dropped.
    expect(
      await resolveFontOrigins("https://cdn.example.com/css/inter.css"),
    ).toEqual(["https://cdn.example.com"]);
  });
});
