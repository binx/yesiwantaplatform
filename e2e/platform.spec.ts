import { expect, test, type Page } from "@playwright/test";

/**
 * The platform, end to end in a browser, without Stripe or Lob: a visitor
 * reads the pitch, an artist opens a studio, starts an edition and goes live,
 * the directory, their page and the edition show them, and a second person
 * gets as far as the collect form before Stripe's absence stops them with a
 * sentence.
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

/** Six postcards, a banner, and the edition put on sale — through the API. */
async function fillAndSell(page: Page, editionId: string, edition: Record<string, unknown>) {
  const headers = { "x-csrf-token": await csrfOf(page) };
  const cards: { designId: string }[] = [];
  for (let i = 0; i < 6; i += 1) {
    const design = await page.request.post("/api/studio/designs", {
      headers,
      multipart: { file: { name: "front.png", mimeType: "image/png", buffer: png }, orientation: "landscape", back: JSON.stringify({ text: `card ${i + 1}` }) },
    });
    expect(design.ok()).toBeTruthy();
    cards.push({ designId: ((await design.json()) as { id: string }).id });
  }
  expect((await page.request.put(`/api/studio/editions/${editionId}/cards`, { headers, data: { cards } })).ok()).toBeTruthy();
  const banner = await page.request.post("/api/studio/editions/banner", { headers, multipart: { file: { name: "banner.png", mimeType: "image/png", buffer: png }, alt: "A row of birds" } });
  expect(banner.ok()).toBeTruthy();
  expect((await page.request.put(`/api/studio/editions/${editionId}`, { headers, data: { ...edition, banner: (await banner.json()) as unknown } })).ok()).toBeTruthy();
  expect((await page.request.post(`/api/studio/editions/${editionId}/status`, { headers, data: { status: "on_sale" } })).ok()).toBeTruthy();
  return cards;
}

test("the studio needs a sign-in, then opens a page that goes live once an edition is on sale", async ({ page }) => {
  const email = `artist-${run}@example.com`;
  await page.goto("/studio/new");
  await expect(page).toHaveURL(/\/account\/login$/);

  await register(page, email, `E2E Artist ${run}`);
  await signIn(page, email);

  await page.goto("/studio/new");
  await expect(page.getByRole("heading", { name: "Open a studio", level: 1 })).toBeVisible();
  const slug = `e2e-artist-${run}`;
  await page.getByLabel("Your address").fill(slug);
  await page.getByLabel("One line about what you send (optional)").fill("test cards from the suite");
  await page.getByLabel("Your page").fill("Made by a **robot**.");
  await page.getByRole("button", { name: "Open your studio" }).click();

  await expect(page).toHaveURL(/\/studio\/?$/);
  await expect(page.getByText("Your page is a draft")).toBeVisible();
  // Nothing on sale: going live is refused before it is even offered.
  await expect(page.getByRole("button", { name: "Go live" })).toBeDisabled();

  // The page is not public yet.
  await page.goto(`/artist/${slug}`);
  await expect(page.getByRole("heading", { name: "Not found", level: 1 })).toBeVisible();

  // Start an edition in the studio.
  await page.goto("/studio/editions/new");
  await page.getByLabel("Title").fill("Birds");
  await expect(page.getByLabel("Its address")).toHaveValue("birds");
  await page.getByLabel("Price for the whole set").fill("30.00");
  await expect(page.getByText(/Each card earns you/)).toBeVisible();
  await page.getByRole("button", { name: "Start this edition" }).click();
  await expect(page).toHaveURL(/\/studio\/editions\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "The cards", level: 2 })).toBeVisible();
  // Six empty slots: not yet sellable.
  await expect(page.getByRole("button", { name: "Put on sale" })).toBeDisabled();

  // Its cards and banner through the API; the designer is covered by the server suite.
  const editionId = page.url().split("/").pop()!;
  await fillAndSell(page, editionId, { slug: "birds", title: "Birds", description: "Six birds from the **road**.", cardCount: 6, priceCents: 3000 });

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
  expect((await apiPage.request.post("/api/studio", { headers, data: { slug, name: "Live Artist" } })).ok()).toBeTruthy();
  const edition = { slug: "flowers", title: "Flowers", description: "Six flowers from the garden.", cardCount: 6, priceCents: 3000 };
  const created = await apiPage.request.post("/api/studio/editions", { headers, data: edition });
  expect(created.ok()).toBeTruthy();
  const cards = await fillAndSell(apiPage, ((await created.json()) as { id: string }).id, edition);
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
  // Left empty, the run starts on the next 1st or 15th, and the schedule says so.
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
