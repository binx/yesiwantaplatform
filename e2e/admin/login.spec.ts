import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../fixtures/admin";

/**
 * The one admin screen that has to work signed *out*: nothing else can be
 * reached without going through it first. Runs with no storage state — every
 * other admin spec starts already authenticated via `global-setup.ts`.
 */

test("signs in with the right credentials and lands on the overview", async ({ page }) => {
  await page.goto("/admin/login");

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
});

test("rejects the wrong password without saying which field was wrong", async ({ page }) => {
  await page.goto("/admin/login");

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login$/);
});
