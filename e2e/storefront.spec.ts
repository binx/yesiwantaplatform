import { expect, test, type Page } from "@playwright/test";

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

test("browses from the landing page to the designer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Postcard Gifts", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /sold already/i }).click();
  await expect(page).toHaveURL(/\/create$/);
});

test("designs a card, adds a recipient and sees the right total in the cart", async ({ page }) => {
  await designOne(page);

  await expect(page.getByRole("button", { name: "Remove design 1" })).toBeVisible();

  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Marfa");
  await page.getByLabel("State").fill("TX");
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
  await page.getByLabel("State").fill("TX");
  await page.getByLabel("ZIP").fill("79843");
  await page.getByRole("button", { name: "Add recipient" }).click();

  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText("2 designs to 1 recipient")).toBeVisible();
  // Two dates, forty days apart, not one plus a cadence.
  await expect(page.getByText(/Mailed .+ to .+/)).toBeVisible();
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

test("refuses a recipient that would not fit on the card, before the cart", async ({ page }) => {
  await page.goto("/create");
  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Marfa");
  await page.getByLabel("State").fill("TX");
  await page.getByLabel("ZIP").fill("9784");
  await page.getByRole("button", { name: "Add recipient" }).click();
  await expect(page.getByRole("alert")).toContainText("5-digit ZIP");
});

test("survives a reload without losing the cart", async ({ page }) => {
  await designOne(page);
  await page.getByLabel("Name").fill("Grandma");
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Marfa");
  await page.getByLabel("State").fill("TX");
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
  await page.getByLabel("State").fill("TX");
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
