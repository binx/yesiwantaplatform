import { expect, test, type Page } from "@playwright/test";

/**
 * The platform, end to end in a browser, without Stripe or Lob: a visitor
 * reads the pitch, an artist opens a studio and goes live, the directory and
 * the page show them, and a second person gets as far as the subscribe form
 * before Stripe's absence stops them with a sentence.
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
  await expect(page.getByText("let's move beyond social media")).toBeVisible();
  await page.getByRole("link", { name: "YES I WANT A POSTCARD", exact: true }).click();
  await expect(page).toHaveURL(/\/artists$/);
  await expect(page.getByRole("heading", { name: "Artists", level: 1 })).toBeVisible();
});

test("the studio needs a sign-in, then opens a page that goes live once a card is queued", async ({ page }) => {
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
  await page.getByLabel("Monthly price").fill("5.00");
  await page.getByRole("button", { name: "Open your studio" }).click();

  await expect(page).toHaveURL(/\/studio\/?$/);
  await expect(page.getByText("Your page is a draft")).toBeVisible();
  // Nothing queued: going live is refused before it is even offered.
  await expect(page.getByRole("button", { name: "Go live" })).toBeDisabled();

  // The page is not public yet.
  await page.goto(`/artist/${slug}`);
  await expect(page.getByRole("heading", { name: "Not found", level: 1 })).toBeVisible();

  // Queue a card: the designer wants a real image, which a Playwright buffer provides.
  await page.goto("/studio/queue");
  await expect(page.getByRole("heading", { name: "Make a postcard", level: 2 })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "front.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Note for the back").fill("A card from the test suite.");
  await page.getByRole("button", { name: "Save this postcard" }).click();
  await expect(page.getByRole("heading", { name: "Made, not yet queued", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Queue it" }).click();
  await expect(page.getByText("queued", { exact: true })).toBeVisible();

  await page.goto("/studio");
  await page.getByRole("button", { name: "Go live" }).click();
  await expect(page.getByRole("heading", { name: "You're live" })).toBeVisible();

  // Now public, and in the directory.
  await page.goto(`/artist/${slug}`);
  await expect(page.getByRole("heading", { name: `E2E Artist ${run}`, level: 1 })).toBeVisible();
  await expect(page.getByText("Made by a robot.")).toBeVisible();
  await expect(page.getByRole("link", { name: "This is your page — open the studio" })).toBeVisible();

  await page.goto("/artists");
  await expect(page.getByRole("link", { name: new RegExp(`E2E Artist ${run}`) })).toBeVisible();
});

test("subscribing asks for an address and stops at Stripe when it is not configured", async ({ page, browser }) => {
  // An artist, made through the API so this test does not depend on the one above.
  const artistEmail = `artist2-${run}@example.com`;
  const slug = `e2e-live-${run}`;
  const api = await browser.newContext();
  const apiPage = await api.newPage();
  await register(apiPage, artistEmail, "Live Artist");
  await signIn(apiPage, artistEmail);
  const csrf = (await apiPage.request.get("/api/session").then((r) => r.json())) as { csrfToken: string };
  const created = await apiPage.request.post("/api/studio", { headers: { "x-csrf-token": csrf.csrfToken }, data: { slug, name: "Live Artist", monthlyPriceCents: 500 } });
  expect(created.ok()).toBeTruthy();
  const design = await apiPage.request.post("/api/studio/designs", {
    headers: { "x-csrf-token": csrf.csrfToken },
    multipart: { file: { name: "front.png", mimeType: "image/png", buffer: png }, orientation: "landscape", back: JSON.stringify({ text: "hi" }) },
  });
  expect(design.ok()).toBeTruthy();
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const queued = await apiPage.request.post("/api/studio/mailings", { headers: { "x-csrf-token": csrf.csrfToken }, data: { designId: ((await design.json()) as { id: string }).id, mailDate: iso } });
  expect(queued.ok()).toBeTruthy();
  const live = await apiPage.request.post("/api/studio/status", { headers: { "x-csrf-token": csrf.csrfToken }, data: { status: "live" } });
  expect(live.ok()).toBeTruthy();
  await api.close();

  // The fan.
  const fanEmail = `fan-${run}@example.com`;
  await register(page, fanEmail, "Grandma");
  await signIn(page, fanEmail);

  await page.goto(`/artist/${slug}`);
  await page.getByRole("link", { name: "YES I WANT A POSTCARD", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/subscribe/${slug}$`));
  await expect(page.getByRole("heading", { name: "Yes, you want a postcard", level: 1 })).toBeVisible();

  await page.getByLabel("Name on the card").fill("Grandma");
  await page.getByLabel("Street address").fill("185 Berry St");
  await page.getByLabel("City").fill("San Francisco");
  // A US address's State is a searchable combobox, not free text: filter to the code, then commit it.
  const state = page.getByLabel("State");
  await state.fill("CA");
  await state.press("Enter");
  await page.getByLabel("ZIP").fill("94107");
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
