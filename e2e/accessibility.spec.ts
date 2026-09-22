import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./fixtures/admin";
import { report, scan } from "./axe";

/**
 * The accessibility gate: axe against every route, under both projects, so
 * each is checked at desktop width and again on a phone.
 */

const routes: [name: string, path: string][] = [
  ["landing", "/"],
  ["artists", "/artists"],
  ["gallery", "/gallery"],
  ["unknown artist", "/artist/nobody-by-this-name"],
  ["404", "/no-such-page-here"],
  ["customer sign-in", "/account/login"],
  ["customer registration", "/account/register"],
  ["forgot password", "/account/forgot-password"],
  ["reset password", "/account/reset-password?token=not-a-real-token"],
  ["admin sign-in", "/admin/login"],
];

for (const [name, path] of routes) {
  test(`${name} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const found = report(await scan(page));
    expect(found, found).toBe("");
  });
}

test.describe("admin, signed in", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  const adminRoutes: [name: string, path: string][] = [
    ["overview", "/admin"],
    ["artists", "/admin/artists"],
    ["mailings", "/admin/mailings"],
    ["payouts", "/admin/payouts"],
    ["people", "/admin/customers"],
    ["pages", "/admin/pages"],
    ["settings", "/admin/settings"],
  ];

  for (const [name, path] of adminRoutes) {
    test(`${name} has no accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // antd's loading skeletons carry empty headings; scan the page, not
      // the placeholder it shows while the queries are in flight.
      await expect(page.locator(".ant-skeleton")).toHaveCount(0);
      const found = report(await scan(page));
      expect(found, found).toBe("");
    });
  }
});

test("the mobile nav drawer has no accessibility violations", async ({ page }) => {
  // Not the front page: its hero carries the navigation and there is no drawer.
  await page.goto("/artists");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const menu = page.getByRole("button", { name: "Open menu" });
  test.skip(!(await menu.isVisible()), "the drawer is mobile-only");
  await menu.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const found = report(await scan(page));
  expect(found, found).toBe("");
});

test("the site's first tab stop is the skip link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeVisible();
});

const UNCONFIGURED = {
  needsSetup: true,
  hasAdmin: false,
  hasSettings: false,
  hasStripeSecret: false,
  stripeMode: null,
  requiresToken: false,
  publicUrl: "http://localhost:5173",
};

async function openWizard(page: Page, status: Record<string, unknown> = {}) {
  await page.route("**/api/setup", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { ...UNCONFIGURED, ...status } });
  });
  await page.goto("/setup");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("the setup wizard's first step has no accessibility violations", async ({ page }) => {
  await openWizard(page);
  await expect(page.getByLabel("Platform name")).toBeVisible();
  const found = report(await scan(page));
  expect(found, found).toBe("");
});
