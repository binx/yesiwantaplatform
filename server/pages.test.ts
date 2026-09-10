import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { RESERVED_PAGE_SLUGS } from "../shared/schema.js";
import { renderMarkdown } from "./markdown.js";

let app: Express;
const PASSWORD = "a-sufficiently-long-test-password";

async function signIn() {
  const agent = request.agent(app);
  const bootstrap = await agent.get("/api/session").expect(200);
  const login = await agent.post("/api/session").set("x-csrf-token", bootstrap.body.csrfToken as string).send({ email: "pages@example.com", password: PASSWORD }).expect(200);
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
  it("renders prose and strips scripts, javascript: hrefs and event handlers", () => {
    expect(renderMarkdown("## Returns\n\nEmail us within *30 days*.")).toContain("<em>30 days</em>");
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script");
    expect(renderMarkdown("[click](javascript:alert(1))").toLowerCase()).not.toContain("javascript:");
    expect(renderMarkdown('<img src="x" onerror="alert(1)">')).not.toContain("onerror");
  });
});

describe("reserved slugs", () => {
  it.each(Object.keys(RESERVED_PAGE_SLUGS))("refuses a page at /%s", async (slug) => {
    const { agent, csrf } = await signIn();
    const response = await agent.post("/api/admin/pages").set("x-csrf-token", csrf).send({ slug, title: "Nope", body: "", isLive: true, inNav: false }).expect(400);
    expect(response.body.error).toContain(`/${slug}`);
  });
});

describe("pages over HTTP", () => {
  it("publishes a page readable at its slug, in the store snapshot and the sitemap", async () => {
    const { agent, csrf } = await signIn();
    await agent.post("/api/admin/pages").set("x-csrf-token", csrf).send({ slug: "faq", title: "FAQ", body: "## Hi\n\n<script>alert(1)</script>", isLive: true, inNav: true }).expect(201);

    const page = await request(app).get("/api/pages/faq").expect(200);
    expect(page.body.bodyHtml).toContain("<h2>Hi</h2>");
    expect(page.body.bodyHtml).not.toContain("<script");
    expect(page.body.body).toBeUndefined();

    const store = await request(app).get("/api/store").expect(200);
    expect((store.body.pages as { slug: string }[]).map((p) => p.slug)).toContain("faq");

    const sitemap = await request(app).get("/sitemap.xml").expect(200);
    expect(sitemap.text).toContain("/faq");
    expect(sitemap.text).toContain("/create");
  });

  it("hides a draft publicly and shows it in the admin", async () => {
    const { agent, csrf } = await signIn();
    await agent.post("/api/admin/pages").set("x-csrf-token", csrf).send({ slug: "terms", title: "Terms", body: "Coming soon.", isLive: false, inNav: false }).expect(201);
    await request(app).get("/api/pages/terms").expect(404);
    const admin = await agent.get("/api/admin/pages").expect(200);
    expect((admin.body as { slug: string; isLive: boolean }[]).find((p) => p.slug === "terms")?.isLive).toBe(false);
  });

  it("refuses a second page at the same slug", async () => {
    const { agent, csrf } = await signIn();
    await agent.post("/api/admin/pages").set("x-csrf-token", csrf).send({ slug: "contact", title: "Contact", body: "", isLive: true, inNav: false }).expect(201);
    await agent.post("/api/admin/pages").set("x-csrf-token", csrf).send({ slug: "contact", title: "Again", body: "", isLive: true, inNav: false }).expect(409);
  });
});
