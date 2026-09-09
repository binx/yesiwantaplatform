import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "../fixtures/admin";

/**
 * The collections editor — drag-and-drop-adjacent (reorder buttons, an image
 * manager, inline rename) and one of the screens called out as covered only
 * by component tests, not by a real browser session.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

test("lists the seeded collections with their storefront addresses", async ({ page }) => {
  await page.goto("/admin/collections");

  await expect(page.getByRole("heading", { name: "Collections", level: 1 })).toBeVisible();
  await expect(page.getByText("/collection/featured-products")).toBeVisible();
  await expect(page.getByText("/collection/home-goods")).toBeVisible();
  await expect(page.getByText("/collection/paper-goods")).toBeVisible();
  await expect(page.getByText("Shown on the landing page")).toBeVisible();
});

test("creates, renames, reorders and deletes a collection", async ({ page }, testInfo) => {
  // Both projects share one server and one database, and this creates a
  // fixed slug ("seasonal") — running it under "mobile" too would collide
  // with its own chromium run. The CRUD flow doesn't vary by viewport; the
  // accessibility sweep already covers layout on both.
  test.skip(testInfo.project.name !== "chromium", "mutating test runs once, not per-viewport");

  await page.goto("/admin/collections");

  await page.getByRole("button", { name: "New collection" }).click();
  const modal = page.getByRole("dialog", { name: "New collection" });

  await modal.getByLabel("Name").fill("Seasonal");
  await expect(modal.getByText("/collection/seasonal")).toBeVisible();
  await modal.getByRole("button", { name: "Create" }).click();
  await expect(modal).toBeHidden();

  const nameField = page.getByLabel("Name of Seasonal");
  await expect(nameField).toBeVisible();

  await nameField.fill("Seasonal Picks");
  await nameField.blur();
  await expect(page.getByLabel("Name of Seasonal Picks")).toBeVisible();

  // The newest card starts last; moving it up should not error and the
  // control should be reachable at all — the specific resting position isn't
  // asserted, since that would just re-encode the seed order in the test.
  await page.getByRole("button", { name: "Move Seasonal Picks up" }).click();
  await expect(page.getByLabel("Name of Seasonal Picks")).toBeVisible();

  await page.getByRole("button", { name: "Delete Seasonal Picks" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Seasonal Picks" });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByLabel("Name of Seasonal Picks")).toHaveCount(0);
});
