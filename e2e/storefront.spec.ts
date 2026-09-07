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
