import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "../fixtures/admin";

/**
 * The Overview cards — the first screen an operator sees, and the one
 * previously verified only by clicking through it by hand. Assertions lean on
 * `global-setup.ts`'s known state: the demo catalogue (five live products, no
 * orders) seeded into an e2e database with no Stripe secret and no SMTP
 * configured.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

/**
 * Scoped to the one `.ant-statistic` whose title matches, rather than a bare
 * `getByText(value)` — the value alone ("5", "0") is too generic to locate
 * unambiguously, and antd renders the title and the value as separate nodes
 * that a plain text match can't associate with each other.
 */
function statistic(page: Page, title: string) {
  return page.locator(".ant-statistic").filter({ has: page.getByText(title, { exact: true }) });
}

test("shows the seeded catalogue's stats and an empty order history", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  // Not "Managing Beluga Demo.": the store name is global config that
  // settings.spec.ts renames and restores, and asserting its exact text here
  // would race that file under `fullyParallel`.
  await expect(statistic(page, "Live products").locator(".ant-statistic-content-value")).toHaveText(
    "5",
  );
  await expect(statistic(page, "Orders").locator(".ant-statistic-content-value")).toHaveText("0");

  await expect(page.getByText("No orders yet")).toBeVisible();
});

test("flags that Stripe is not connected", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  await expect(page.getByText("Stripe is not connected")).toBeVisible();
  await expect(
    page.getByText("The catalogue works, but nothing can be sold."),
  ).toBeVisible();
});

test("New product opens a blank product editor", async ({ page }) => {
  await page.goto("/admin");

  await page.getByRole("link", { name: "New product" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new$/);
});
