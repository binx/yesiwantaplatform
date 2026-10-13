import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./fixtures/admin";

/**
 * The platform, end to end in a browser, without Stripe or Lob: a visitor
 * reads the pitch, an artist opens a studio, starts an edition and sends it
 * for review, the admin approves both, the artist goes live, the directory,
 * their page and the edition show them, and a second person gets as far as
 * the collect form before Stripe's absence stops them with a sentence.
 *
 * Each run makes its own accounts, so the suite is safe to rerun against a
 * reused e2e database.
 */

const PASSWORD = "an-e2e-password-that-is-long-enough";
const run = Date.now().toString(36);

/** A 1×1 PNG, enough for the upload route to accept as a photo. */
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

async function register(page: Page, email: string, name: string) {
  await page.goto("/account/register");
  await page.getByLabel("Name (optional)").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

async function signIn(page: Page, email: string) {
  await page.goto("/account/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account\/?$/);
}

test("the front page makes the pitch and points at the artists", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("yes");
  await expect(page.getByText("Pay once, then let the mail surprise you.")).toBeVisible();
  await page.getByRole("link", { name: "YES I WANT A POSTCARD", exact: true }).click();
  await expect(page).toHaveURL(/\/artists$/);
  await expect(page.getByRole("heading", { name: "Artists", level: 1 })).toBeVisible();
});

/** The signed-in page's CSRF token, for building things through the API where clicking through would only be slow. */
async function csrfOf(page: Page): Promise<string> {
  return ((await page.request.get("/api/session").then((r) => r.json())) as { csrfToken: string }).csrfToken;
}

/** The admin's yes to the page and the edition, through the API with the fixture's cookies. */
async function approve(browser: Browser, artistId: string, editionId: string) {
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
  const headers = { "x-csrf-token": ((await admin.request.get("/api/session").then((r) => r.json())) as { csrfToken: string }).csrfToken };
  expect((await admin.request.post(`/api/admin/artists/${artistId}/review`, { headers, data: { decision: "approved" } })).ok()).toBeTruthy();
  expect((await admin.request.post(`/api/admin/editions/${editionId}/review`, { headers, data: { decision: "approved" } })).ok()).toBeTruthy();
  await admin.close();
}

/** Six postcards, a banner, the edition sent for review, and the admin's yes — through the API. */
async function fillAndSell(page: Page, browser: Browser, editionId: string, edition: Record<string, unknown>) {
  const headers = { "x-csrf-token": await csrfOf(page) };
  const cards: { designId: string }[] = [];
  for (let i = 0; i < 6; i += 1) {
    const design = await page.request.post("/api/studio/designs", {
      headers,
      multipart: { file: { name: "front.png", mimeType: "image/png", buffer: png }, orientation: "landscape" },
    });
    expect(design.ok()).toBeTruthy();
    cards.push({ designId: ((await design.json()) as { id: string }).id });
  }
  expect((await page.request.put(`/api/studio/editions/${editionId}/cards`, { headers, data: { cards } })).ok()).toBeTruthy();
  const banner = await page.request.post("/api/studio/editions/banner", { headers, multipart: { file: { name: "banner.png", mimeType: "image/png", buffer: png }, alt: "A row of birds" } });
  expect(banner.ok()).toBeTruthy();
  expect((await page.request.put(`/api/studio/editions/${editionId}`, { headers, data: { ...edition, banner: (await banner.json()) as unknown } })).ok()).toBeTruthy();
  expect((await page.request.post(`/api/studio/editions/${editionId}/status`, { headers, data: { status: "in_review" } })).ok()).toBeTruthy();
  const studio = (await page.request.get("/api/studio").then((r) => r.json())) as { artist: { id: string } };
  await approve(browser, studio.artist.id, editionId);
  return cards;
}

test("the studio needs a sign-in, then opens a page that goes live once an edition is approved", async ({ page, browser }) => {
  const email = `artist-${run}@example.com`;
  await page.goto("/studio/new");
  await expect(page).toHaveURL(/\/account\/login$/);

  await register(page, email, `E2E Artist ${run}`);
  await signIn(page, email);

  await page.goto("/studio/new");
  await expect(page.getByRole("heading", { name: "Open a studio", level: 1 })).toBeVisible();
  // Step one: the name is already on the account; the URL is chosen here, once.
  const slug = `e2e-artist-${run}`;
  await page.getByLabel("Your studio URL").fill(slug);
  await page.getByRole("button", { name: "Continue" }).click();
  // Step two: the page. It always has a banner: without one the setup won't go on.
  await page.getByLabel("About you").fill("Made by a **robot**.");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload a banner" }).click();
  await (await chooser).setFiles({ name: "banner.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("button", { name: "Replace banner" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // Step three: links and the gallery, both optional, then the button that makes the studio.
  await page.getByRole("button", { name: "View your studio" }).click();

  await expect(page).toHaveURL(/\/studio\/?$/);
  await expect(page.getByText("Your page is waiting for review")).toBeVisible();
  // Not approved, nothing on sale: going live is refused before it is even offered.
  await expect(page.getByRole("button", { name: "Go live" })).toBeDisabled();
  // The account page says so too.
  await page.goto("/account");
  await expect(page.getByText("Your page is waiting for review")).toBeVisible();

  // The page is not public yet.
  await page.goto(`/artist/${slug}`);
  await expect(page.getByRole("heading", { name: "Not found", level: 1 })).toBeVisible();

  // Start an edition in the studio.
  await page.goto("/studio/editions/new");
  await page.getByLabel("Title").fill("Birds");
  await expect(page.getByLabel("Edition URL")).toHaveValue("birds");
  await page.getByLabel("Price for the whole edition").fill("30.00");
  await expect(page.getByText(/Each card earns you/)).toBeVisible();
  await page.getByRole("button", { name: "Start this edition" }).click();
  await expect(page).toHaveURL(/\/studio\/editions\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "The cards", level: 2 })).toBeVisible();
  // Six empty slots: not yet sendable.
  await expect(page.getByRole("button", { name: "Send for review" })).toBeDisabled();

  // Its cards and banner through the API, and the admin's yes; the designer is covered by the server suite.
  const editionId = page.url().split("/").pop()!;
  await fillAndSell(page, browser, editionId, { slug: "birds", title: "Birds", description: "Six birds from the **road**.", cardCount: 6, priceCents: 3000 });

  await page.goto("/studio");
  await page.getByRole("button", { name: "Go live" }).click();
  await expect(page.getByRole("heading", { name: "You're live" })).toBeVisible();

  // Now public, with the edition on the page, and in the directory.
  await page.goto(`/artist/${slug}`);
  await expect(page.getByRole("heading", { name: `E2E Artist ${run}`, level: 1 })).toBeVisible();
  await expect(page.getByText("Made by a robot.")).toBeVisible();
  await page.getByRole("link", { name: /Birds/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/artist/${slug}/birds$`));
  await expect(page.getByRole("heading", { name: "Birds", level: 1 })).toBeVisible();
  await expect(page.getByText("Six birds from the road.")).toBeVisible();

  await page.goto("/artists");
  await expect(page.getByRole("link", { name: new RegExp(`E2E Artist ${run}`) })).toBeVisible();
});

test("collecting asks for an address and a day, shows the schedule, and stops at Stripe when it is not configured", async ({ page, browser }) => {
  // An artist with an edition on sale, made through the API so this test does not depend on the one above.
  const artistEmail = `artist2-${run}@example.com`;
  const slug = `e2e-live-${run}`;
  const api = await browser.newContext();
  const apiPage = await api.newPage();
  await register(apiPage, artistEmail, "Live Artist");
  await signIn(apiPage, artistEmail);
  const headers = { "x-csrf-token": await csrfOf(apiPage) };
  // A page always has a banner, uploaded before the page exists.
  const banner = await apiPage.request.post("/api/studio/banner", { headers, multipart: { file: { name: "banner.png", mimeType: "image/png", buffer: png } } });
  expect(banner.ok()).toBeTruthy();
  expect((await apiPage.request.post("/api/studio", { headers, data: { slug, name: "Live Artist", banner: (await banner.json()) as unknown } })).ok()).toBeTruthy();
  const edition = { slug: "flowers", title: "Flowers", description: "Six flowers from the garden.", cardCount: 6, priceCents: 3000 };
  const created = await apiPage.request.post("/api/studio/editions", { headers, data: edition });
  expect(created.ok()).toBeTruthy();
  const cards = await fillAndSell(apiPage, browser, ((await created.json()) as { id: string }).id, edition);
  expect((await apiPage.request.post("/api/studio/status", { headers, data: { status: "live" } })).ok()).toBeTruthy();
  await api.close();

  // The fan.
  const fanEmail = `fan-${run}@example.com`;
  await register(page, fanEmail, "Grandma");
  await signIn(page, fanEmail);

  await page.goto(`/artist/${slug}/flowers`);
  // A surprise: the edition's page carries none of its cards.
  const html = await page.content();
  for (const card of cards) expect(html).not.toContain(card.designId);
  await page.getByRole("link", { name: "Collect this edition" }).click();
  await expect(page).toHaveURL(new RegExp(`/collect/${slug}/flowers$`));
  await expect(page.getByRole("heading", { name: "Collect Flowers", level: 1 })).toBeVisible();

  await page.getByLabel("Name on the card").fill("Grandma");
  await page.getByLabel("Street address").fill("185 Berry St");
  await page.getByLabel("City").fill("San Francisco");
  // A US address's State is a searchable combobox, not free text: filter to the code, then commit it.
  const state = page.getByLabel("State");
  await state.fill("CA");
  await state.press("Enter");
  await page.getByLabel("ZIP").fill("94107");
  // The day is filled in with the next 1st or 15th, and the schedule shows the run from it.
  await expect(page.getByRole("list", { name: "Every card's day" }).getByRole("listitem")).toHaveCount(6);
  await page.getByRole("button", { name: "Continue to payment" }).click();

  // No Stripe in the e2e environment: the API says so, in a sentence.
  await expect(page.getByText(/Stripe is not configured/)).toBeVisible();
});

test("the gallery and an unknown artist both render something honest", async ({ page }) => {
  await page.goto("/gallery");
  await expect(page.getByRole("heading", { name: "Gallery", level: 1 })).toBeVisible();
  await page.goto("/artist/nobody-by-this-name");
  await expect(page.getByRole("heading", { name: "Not found", level: 1 })).toBeVisible();
});
