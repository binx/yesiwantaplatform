import { expect, test } from "@playwright/test";

/**
 * Phase 1 smoke: the storefront browses and the cart holds its state.
 * The purchase leg arrives in Phase 3, once Checkout Sessions exist.
 */

test("browses from the landing page to a product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Beluga Demo", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Shop everything" }).click();
  await expect(page).toHaveURL(/\/shop$/);

  await page.getByRole("link", { name: /Home Goods/ }).first().click();
  await expect(page.getByRole("heading", { name: "Home Goods" })).toBeVisible();
});

test("adds a variant to the cart and shows the right subtotal", async ({ page }) => {
  await page.goto("/product/canvas-tote");

  // The picker must be present for a single-axis product.
  const picker = page.getByRole("combobox").first();
  await expect(picker).toBeVisible();

  await picker.click();
  await page.getByTitle("Large").click();
  await expect(page.getByText("$42.00")).toBeVisible();

  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);

  await expect(page.getByRole("cell", { name: "$42.00" })).toBeVisible();
  await expect(page.getByText("Subtotal")).toBeVisible();
});

test("buys a two-axis product by choosing across both selectors", async ({ page }) => {
  await page.goto("/product/zip-hoodie");

  const size = page.getByRole("combobox").nth(0);
  const colour = page.getByRole("combobox").nth(1);
  await expect(size).toBeVisible();
  await expect(colour).toBeVisible();

  await expect(page.getByText("$58.00")).toBeVisible();

  await size.click();
  await page.getByTitle("Large").click();
  await expect(page.getByText("$62.00")).toBeVisible();

  await colour.click();
  await page.getByTitle("Navy").click();
  await expect(page.getByText("$62.00")).toBeVisible();

  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("cell", { name: "$62.00" })).toBeVisible();
});

test("clamps the cart quantity to available stock", async ({ page }) => {
  await page.goto("/product/canvas-tote");

  await page.getByRole("combobox").first().click();
  await page.getByTitle("Large").click(); // 2 in stock
  await page.getByRole("button", { name: "Add to cart" }).click();

  const quantity = page.getByRole("spinbutton", { name: /Quantity for/ });
  await quantity.fill("999");
  await quantity.blur();

  await expect(quantity).toHaveValue("2");
  await expect(page.getByRole("cell", { name: "$84.00" })).toBeVisible();
});

test("survives a reload without losing the cart", async ({ page }) => {
  await page.goto("/product/enamel-mug");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);

  await page.reload();
  await expect(page.getByRole("cell", { name: "$18.00" })).toBeVisible();
});

test("a sold-out product cannot be purchased", async ({ page }) => {
  await page.goto("/product/risograph-print");
  await expect(page.getByRole("button", { name: "Sold out" })).toBeDisabled();
});

test("removing the only line empties the cart", async ({ page }) => {
  await page.goto("/product/enamel-mug");
  await page.getByRole("button", { name: "Add to cart" }).click();

  // A real button, so it is reachable by keyboard.
  await page.getByRole("button", { name: /Remove Enamel Mug/ }).click();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
});

test("unknown routes render the 404 page", async ({ page }) => {
  await page.goto("/product/does-not-exist");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("checkout explains itself when Stripe is not configured", async ({ page }) => {
  // A store owner hits this before adding keys; it must not be a dead button.
  await page.goto("/product/enamel-mug");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);

  await page.getByRole("button", { name: "Checkout" }).click();
  await expect(page.getByText(/Stripe is not configured/i)).toBeVisible();
});

test("the confirmation page handles being opened without an order", async ({ page }) => {
  await page.goto("/confirm");
  await expect(page.getByRole("heading", { name: "No order to show" })).toBeVisible();
});

test("the carousel is operable by keyboard and opens a lightbox", async ({ page }) => {
  await page.goto("/product/canvas-tote");

  const thumbs = page.getByRole("tab");
  await expect(thumbs).toHaveCount(3);
  await expect(thumbs.first()).toHaveAttribute("aria-selected", "true");

  // Arrow keys move the carousel without a mouse.
  await page.getByRole("group", { name: /Canvas Tote images/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(thumbs.nth(1)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("End");
  await expect(thumbs.nth(2)).toHaveAttribute("aria-selected", "true");

  // Every slide carries real alt text, so none of it is invisible to
  // assistive tech — v1 painted these as CSS background images.
  await expect(page.getByAltText("Canvas tote, front view")).toBeAttached();

  // Clicking a slide opens the zoom view, and Escape closes it.
  await page.getByAltText("Canvas tote, front view").click({ force: true });
  await expect(page.locator(".ant-image-preview-img")).toBeVisible();
  // The lightbox brings its own prev/next, so zooming does not trap the user.
  await expect(page.locator(".ant-image-preview-switch-next")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview-img")).toBeHidden();
});

test("a single-image product renders without carousel chrome", async ({ page }) => {
  await page.goto("/product/risograph-print");
  // No thumbnails or arrows for one image.
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next image" })).toHaveCount(0);
});
