import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./fixtures/admin";

/**
 * The buyer's path: design a card, schedule it, address it, put it in the
 * cart, and find out at checkout that Stripe is not configured — which is
 * the honest end of the road on a fixture with no keys.
 */

/** A 1×1 PNG, enough for the upload route to accept as a photo. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

async function designOne(page: Page) {
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "Make a postcard", level: 1 })).toBeVisible();

  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await page.getByLabel("Note for the back").fill("Wish you were here");
  await page.getByRole("button", { name: "Save this design" }).click();
  await expect(page.getByRole("button", { name: "Saved!" })).toBeVisible();
}

/** A US address's State is a searchable combobox, not free text: filter to the code, then commit it. */
async function selectState(page: Page, code: string) {
  const field = page.getByLabel("State");
  await field.fill(code);
  await field.press("Enter");
}

test("browses from the landing page to the designer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Postcard Gifts", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /sold already/i }).click();
  await expect(page).toHaveURL(/\/create$/);
});

test("designs a card, adds a recipient and sees the right total in the cart", async ({ page }) => {
  await designOne(page);

  await expect(page.getByRole("button", { name: "Remove design 1" })).toBeVisible();

  // The freshly saved thumbnail must render on first paint, not a broken
  // image while Vite's public-directory watcher catches up to the API's
  // write (the bug in task 15).
  await expect(page.locator("section[aria-labelledby=schedule-heading] img").first()).toHaveJSProperty(
    "naturalWidth",
    408,
  );

  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Marfa");
  await selectState(page, "TX");
  await page.getByLabel("ZIP").fill("79843");
  await page.getByRole("button", { name: "Add recipient" }).click();
  await expect(page.getByRole("list", { name: "Recipients" })).toContainText("Grandma");

  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText("1 design to 1 recipient")).toBeVisible();
  await expect(page.getByText("$1.40").first()).toBeVisible();
});

test("mails two designs on two chosen dates", async ({ page }) => {
  await designOne(page);

  // A second design, saved on the same page so the first is still there.
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "photo2.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Save this design" }).click();
  await expect(page.getByRole("button", { name: "Remove design 2" })).toBeVisible();

  await page.getByText("Pick each date").click();
  const farOff = new Date();
  farOff.setDate(farOff.getDate() + 40);
  const target = farOff.toISOString().slice(0, 10);
  await page.getByLabel("Mail date for design 2").fill(target);
  await expect(page.getByLabel("Mail date for design 2")).toHaveValue(target);

  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Marfa");
  await selectState(page, "TX");
  await page.getByLabel("ZIP").fill("79843");
  await page.getByRole("button", { name: "Add recipient" }).click();

  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText("2 designs to 1 recipient")).toBeVisible();
  // Two dates, forty days apart, not one plus a cadence.
  await expect(page.getByText(/Mails .+ to .+/)).toBeVisible();
});

test("repositions the photo with the arrow keys and saves that crop", async ({ page }) => {
  await page.goto("/create");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });

  const preview = page.getByRole("img", { name: /Your photo in the card/ });
  await expect(preview).toBeVisible();
  const photo = preview.locator("img");
  // A square photo in a portrait frame overflows sideways, so the centre crop hides some of each edge.
  await expect(photo).toHaveAttribute("style", /translate\(-\d+(\.\d+)?px, 0px\)/);
  const centred = await photo.getAttribute("style");

  await preview.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  // Each nudge moves the photo further left, i.e. a larger hidden offset.
  await expect(photo).not.toHaveAttribute("style", centred ?? "");
  await expect(page.getByText("Drag to reposition")).toHaveCount(0);

  await page.getByRole("button", { name: "Save this design" }).click();
  await expect(page.getByRole("button", { name: "Saved!" })).toBeVisible();
});

test("imports a spreadsheet's CSV, previews the columns, and fixes a bad row by hand", async ({ page }) => {
  await page.goto("/create");
  await page.getByRole("button", { name: "Upload a list" }).click();

  // What Excel exports in a European locale: a byte-order mark, semicolons, spaced headers.
  const csv =
    "﻿First Name;Last Name;Street Address;City;State;Zip Code\n" +
    "Maya;Okafor;12 Elm St;Marfa;TX;79843\n" +
    "Sam;Lee;3 Oak St;Boston;MA;2134\n";
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: "friends.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });

  const readout = page.getByRole("status", { name: "What was read from the file" });
  await expect(readout).toContainText("1 recipient read, 1 row needs fixing");
  await expect(readout).toContainText("We read Street Address as the street");
  await page.getByRole("button", { name: "Import 1 recipient" }).click();

  await expect(page.getByRole("list", { name: "Recipients" })).toContainText("Maya Okafor");
  const fixes = page.getByRole("region", { name: "Rows that need fixing" });
  await expect(fixes).toContainText("leading zero");

  await fixes.getByRole("button", { name: "Fix line 3" }).click();
  await expect(page.getByLabel("ZIP")).toHaveValue("2134");
  await page.getByLabel("ZIP").fill("02134");
  await page.getByRole("button", { name: "Add recipient" }).click();

  await expect(page.getByRole("list", { name: "Recipients" })).toContainText("Sam Lee");
  await expect(fixes).toHaveCount(0);
});

test("offers USPS's form of an address, and uses it on request", async ({ page }) => {
  // Lob is not configured on the fixture, so USPS is played here.
  await page.route("**/api/recipients/verify", async (route) => {
    const sent = route.request().postDataJSON() as { line1: string };
    await route.fulfill({
      json:
        sent.line1 === "185 berry street"
          ? {
              deliverability: "deliverable",
              suggested: { name: "Grandma", line1: "185 Berry St", line2: null, city: "San Francisco", state: "CA", postalCode: "94107" },
              changed: true,
            }
          : { deliverability: "unknown", suggested: null, changed: false },
    });
  });

  await page.goto("/create");
  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("185 berry street");
  await page.getByLabel("City").fill("San Francisco");
  await selectState(page, "CA");
  await page.getByLabel("ZIP").fill("94107");
  await page.getByRole("button", { name: "Add recipient" }).click();

  await expect(page.getByText("USPS knows this address as:")).toBeVisible();
  await expect(page.getByRole("list", { name: "Recipients" })).not.toContainText("Grandma");
  await page.getByRole("button", { name: "Use this" }).click();

  const list = page.getByRole("list", { name: "Recipients" });
  await expect(list).toContainText("185 Berry St, San Francisco, CA 94107");
  await expect(list).toContainText("Verified");
});

test("shows a country only once the shop mails abroad, then takes a recipient in Canada", async ({ page }) => {
  // This test changes the shop's settings, which every worker shares; one project runs it.
  test.skip(test.info().project.name !== "chromium", "settings are shared across workers");

  // US only, as the fixture is set up: no country to choose.
  await page.goto("/create");
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Country")).toHaveCount(0);
  await expect(page.getByLabel("ZIP")).toBeVisible();

  // The owner sets a price and a return address, which is what turns international mail on.
  const baseURL = test.info().project.use.baseURL;
  const api = await playwrightRequest.newContext({ storageState: ADMIN_STORAGE_STATE, ...(baseURL ? { baseURL } : {}) });
  const { csrfToken } = (await (await api.get("/api/session")).json()) as { csrfToken: string };
  const current = (await (await api.get("/api/admin/settings")).json()) as Record<string, unknown>;
  const returnAddress = { name: "Postcard Gifts", line1: "185 Berry St", line2: null, city: "San Francisco", state: "CA", postalCode: "94107", country: "US" };
  const put = await api.put("/api/admin/settings", { headers: { "x-csrf-token": csrfToken }, data: { ...current, internationalPostcardPriceCents: 250, returnAddress } });
  expect(put.ok()).toBe(true);

  try {
    await page.goto("/create");
    const country = page.getByRole("combobox", { name: "Country" });
    await expect(country).toBeVisible();
    await country.fill("Canada");
    await country.press("Enter");
    await expect(page.getByLabel("Postal code")).toBeVisible();

    await page.getByLabel("Name").fill("Maya");
    await page.getByLabel("Street address").fill("12 Rue Ste-Catherine");
    await page.getByLabel("City").fill("Montréal");
    await page.getByLabel("State / province").fill("QC");
    await page.getByLabel("Postal code").fill("H2X 1K4");
    await page.getByRole("button", { name: "Add recipient" }).click();

    const list = page.getByRole("list", { name: "Recipients" });
    await expect(list).toContainText("12 Rue Ste-Catherine, Montréal, QC H2X 1K4, Canada");
    await expect(page.getByText("International cards take about two weeks longer to arrive.")).toBeVisible();
  } finally {
    await api.put("/api/admin/settings", { headers: { "x-csrf-token": csrfToken }, data: { ...current, internationalPostcardPriceCents: null, returnAddress: null } });
    await api.dispose();
  }
});

test("opens 'land it by a date' as a bottom drawer on a phone, not a popover over the thumbnails", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "this checks the phone-only drawer");

  await designOne(page);
  await page.getByRole("button", { name: "Land it by a date" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("The day that matters")).toBeVisible();
});

test("refuses a recipient that would not fit on the card, before the cart", async ({ page }) => {
  await page.goto("/create");
  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Marfa");
  await selectState(page, "TX");
  await page.getByLabel("ZIP").fill("9784");
  await page.getByRole("button", { name: "Add recipient" }).click();
  await expect(page.getByRole("alert")).toContainText("5-digit ZIP");
});

test("survives a reload without losing the cart", async ({ page }) => {
  await designOne(page);
  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Marfa");
  await selectState(page, "TX");
  await page.getByLabel("ZIP").fill("79843");
  await page.getByRole("button", { name: "Add recipient" }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);

  await page.reload();
  await expect(page.getByText("1 design to 1 recipient")).toBeVisible();

  await page.getByRole("button", { name: /Remove batch 1/ }).click();
  await expect(page.getByText("nothing in your cart yet")).toBeVisible();
});

test("checkout explains itself when Stripe is not configured", async ({ page }) => {
  await designOne(page);
  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Marfa");
  await selectState(page, "TX");
  await page.getByLabel("ZIP").fill("79843");
  await page.getByRole("button", { name: "Add recipient" }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);

  await page.getByRole("button", { name: "Check out" }).click();
  await expect(page.getByText(/Stripe is not configured/i)).toBeVisible();
});

test("unknown routes render the 404 page", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("the confirmation page handles being opened without an order", async ({ page }) => {
  await page.goto("/confirm");
  await expect(page.getByRole("heading", { name: "No order to show" })).toBeVisible();
});

test("the card's own faces load on the designer, whatever the store's theme font", async ({ page }) => {
  await page.goto("/create");
  // Forced rather than awaiting document.fonts.ready: the back-of-card mock
  // may not render (and so never trigger the fetch) before a photo is
  // uploaded, and this asserts the face is loadable, not merely that
  // something on the initial paint happened to ask for it first. Cast rather
  // than widening this project's tsconfig to the DOM lib: `document` here is
  // the browser's, evaluated inside the page, not Node's.
  const patrickHandLoaded = await page.evaluate(async () => {
    const fonts = (globalThis as unknown as { document: { fonts: Iterable<{ family: string; status: string }> & { load(font: string): Promise<unknown> } } }).document.fonts;
    await fonts.load('16px "Patrick Hand"');
    return [...fonts].some((face) => face.family === "Patrick Hand" && face.status === "loaded");
  });
  expect(patrickHandLoaded).toBe(true);
});

test("the footer sits at the bottom of a short page, not above a band of page-grey", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/cart");
  const footer = page.locator("footer");
  const box = await footer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeCloseTo(800, 0);
});
