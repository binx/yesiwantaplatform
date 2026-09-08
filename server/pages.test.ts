import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { RESERVED_PAGE_SLUGS } from "../shared/schema.js";
import { renderMarkdown } from "./markdown.js";

/**
 * Store pages.
 *
 * Two things carry the weight here. The sanitiser, because a page body is
 * written by an administrator — a set of people a merchant invites, since task
 * 07 — and rendered on the storefront for every shopper; and the reserved
 * slugs, because a page at `/cart` is not a security problem but is a merchant
 * staring at a page that will never load with nothing to tell them why.
 */

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

interface PageRow {
  slug: string;
  isLive?: boolean;
  body?: string;
}

const slugsOf = (value: unknown): string[] => (value as PageRow[]).map((page) => page.slug);

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);

  const login = await agent
    .post("/api/session")
    .set("x-csrf-token", bootstrap.body.csrfToken as string)
    .send({ email: "pages@example.com", password: PASSWORD })
    .expect(200);

  return { agent, csrf: login.body.csrfToken as string };
}

beforeAll(async () => {
  const { runMigrations } = await import("../db/migrate.js");
  const { seedIfEmpty } = await import("../db/seed.js");
  const { createAdmin } = await import("./auth.js");
  const { createApp } = await import("./app.js");

  await runMigrations();
  await seedIfEmpty();
  await createAdmin("pages@example.com", PASSWORD);

  app = createApp();
});

describe("the Markdown sanitiser", () => {
  it("renders ordinary prose", () => {
    const html = renderMarkdown("## Returns\n\nEmail us within *30 days*.");

    expect(html).toContain("<h2>Returns</h2>");
    expect(html).toContain("<em>30 days</em>");
  });

  it("strips a script tag and keeps its text inert", () => {
    const html = renderMarkdown("<script>alert(1)</script>");

    expect(html).not.toContain("<script");
    expect(html).not.toContain("</script>");
    // The text survives as prose, which is visible rather than silent.
    expect(html).toContain("alert(1)");
  });

  it("drops a javascript: href", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");

    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("drops a javascript: href hidden behind entity encoding", () => {
    // The parser decodes entities before the scheme is checked, which is the
    // whole reason the check lives in the sanitiser and not in a regex.
    const html = renderMarkdown('<a href="&#106;avascript&#58;alert(1)">click</a>');

    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html.toLowerCase()).not.toContain("alert(1)\">");
  });

  it("drops event-handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">\n\n<p onclick="alert(1)">hi</p>');

    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<img");
  });

  it("drops style, iframe and object tags", () => {
    const html = renderMarkdown(
      '<style>body{display:none}</style><iframe src="https://evil.example"></iframe><object data="x"></object>',
    );

    expect(html).not.toContain("<style");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<object");
  });

  it("marks external links but leaves internal ones alone", () => {
    const html = renderMarkdown("[out](https://example.com) and [in](/shop)");

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    // The internal link keeps the shopper in the tab they are already in.
    expect(html).toMatch(/<a href="\/shop">in<\/a>/);
  });
});

describe("reserved slugs", () => {
  it.each(Object.keys(RESERVED_PAGE_SLUGS))("refuses a page at /%s", async (slug) => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .post("/api/admin/pages")
      .set("x-csrf-token", csrf)
      .send({ slug, title: "Nope", body: "", isLive: true, inNav: false })
      .expect(400);

    // Named, not generic: the merchant has to know what they collided with.
    expect(response.body.error).toContain(`/${slug}`);
    expect(response.body.error).toContain(RESERVED_PAGE_SLUGS[slug]!);
  });
});

describe("pages over HTTP", () => {
  it("publishes a page that is readable at its slug", async () => {
    const { agent, csrf } = await signIn();

    const created = await agent
      .post("/api/admin/pages")
      .set("x-csrf-token", csrf)
      .send({
        slug: "returns",
        title: "Returns",
        body: "## Returns\n\nWithin 30 days.\n\n<script>alert(1)</script>",
        isLive: true,
        inNav: true,
      })
      .expect(201);

    expect(created.body.id).toBeTruthy();

    const page = await request(app).get("/api/pages/returns").expect(200);

    expect(page.body.title).toBe("Returns");
    expect(page.body.bodyHtml).toContain("<h2>Returns</h2>");
    expect(page.body.bodyHtml).not.toContain("<script");
    // The Markdown source and the draft flag are the editor's business.
    expect(page.body.body).toBeUndefined();
    expect(page.body.isLive).toBeUndefined();

    const list = await request(app).get("/api/pages").expect(200);
    expect(slugsOf(list.body)).toContain("returns");

    // The banner reads nav links out of the store snapshot, not a second fetch.
    const store = await request(app).get("/api/store").expect(200);
    expect(slugsOf((store.body as { pages: unknown }).pages)).toContain("returns");
  });

  it("hides a draft publicly and shows it in the admin", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/pages")
      .set("x-csrf-token", csrf)
      .send({ slug: "terms", title: "Terms", body: "Coming soon.", isLive: false, inNav: false })
      .expect(201);

    await request(app).get("/api/pages/terms").expect(404);

    const list = await request(app).get("/api/pages").expect(200);
    expect(slugsOf(list.body)).not.toContain("terms");

    const admin = await agent.get("/api/admin/pages").set("x-csrf-token", csrf).expect(200);
    const draft = (admin.body as PageRow[]).find((page) => page.slug === "terms");
    expect(draft?.isLive).toBe(false);
    // The admin gets the Markdown source; only the storefront gets HTML.
    expect(draft?.body).toBe("Coming soon.");
  });

  it("refuses a second page at the same slug", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .post("/api/admin/pages")
      .set("x-csrf-token", csrf)
      .send({ slug: "contact", title: "Contact", body: "", isLive: true, inNav: false })
      .expect(201);

    await agent
      .post("/api/admin/pages")
      .set("x-csrf-token", csrf)
      .send({ slug: "contact", title: "Contact again", body: "", isLive: true, inNav: false })
      .expect(409);
  });

  it("previews through the same renderer the storefront uses", async () => {
    const { agent, csrf } = await signIn();

    const response = await agent
      .post("/api/admin/pages/preview")
      .set("x-csrf-token", csrf)
      .send({ body: "# Hi\n\n<script>alert(1)</script>" })
      .expect(200);

    expect(response.body.bodyHtml).toBe(renderMarkdown("# Hi\n\n<script>alert(1)</script>"));
    expect(response.body.bodyHtml).not.toContain("<script");
  });

  it("404s an unknown page id rather than writing nothing quietly", async () => {
    const { agent, csrf } = await signIn();

    await agent
      .put("/api/admin/pages/not-a-page")
      .set("x-csrf-token", csrf)
      .send({ slug: "ghost", title: "Ghost", body: "", isLive: false, inNav: false })
      .expect(404);

    await agent.delete("/api/admin/pages/not-a-page").set("x-csrf-token", csrf).expect(404);
  });
});
