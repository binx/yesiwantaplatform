import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "../fixtures/admin";

/**
 * Settings — specifically the hero and email controls flagged as untested:
 * both only show their real behaviour once signed in, so neither could be
 * exercised without `global-setup.ts`'s API-driven session.
 */
test.use({ storageState: ADMIN_STORAGE_STATE });

/**
 * The save flow, exercised through About text rather than the store name.
 *
 * Store name is read by the Heading placeholder further down this same
 * page (and by the Overview header) — mutating it, even briefly, raced
 * those reads under `fullyParallel`. About text has no reader anywhere else
 * in this suite, so the round trip below can't bleed into a sibling test no
 * matter how the runner schedules them.
 */
test("saves a change and clears the dirty state", async ({ page }, testInfo) => {
  // Both projects share one server and one database — running a mutation
  // under "mobile" too would race this same test's own chromium run over the
  // same settings row. The save flow itself doesn't vary by viewport; what
  // would (layout, visibility) is covered by the read-only tests below and by
  // the accessibility sweep, both of which already run on both projects.
  test.skip(testInfo.project.name !== "chromium", "mutating test runs once, not per-viewport");

  await page.goto("/admin/settings");

  const about = page.getByPlaceholder("Who you are, what you make, how to reach you.");
  await expect(about).toHaveValue("");

  const save = page.getByRole("button", { name: "Save changes" }).first();
  await expect(save).toBeDisabled();

  await about.fill("A shop for testing purposes only.");
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(save).toBeDisabled();

  // Restored so the run leaves the fixture the way it found it.
  await about.fill("");
  await save.click();
  await expect(page.getByText("Saved.")).toBeVisible();
});

test("hero fields fall back to the storefront's own defaults", async ({ page }) => {
  await page.goto("/admin/settings");

  await expect(page.getByLabel("Heading")).toHaveValue("");
  await expect(page.getByLabel("Heading")).toHaveAttribute("placeholder", "Beluga Demo");
  await expect(page.getByLabel("Button label")).toHaveAttribute(
    "placeholder",
    "Shop everything",
  );
  await expect(page.getByLabel("Button link")).toHaveAttribute("placeholder", "/shop");
});

test("rejects a hero link that would send shoppers off-site unexpectedly", async ({ page }) => {
  await page.goto("/admin/settings");

  await page.getByLabel("Button link").fill("javascript:alert(1)");

  await expect(
    page.getByText("Use a path starting with / or a full https:// address."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" }).first()).toBeDisabled();

  // Leave the field clean for the next run.
  await page.getByLabel("Button link").fill("");
});

test("email card explains why sending is off, with no live SMTP configured", async ({ page }) => {
  await page.goto("/admin/settings");

  await expect(
    page.getByText("No SMTP_URL on the server, so mail is written to the log instead of sent."),
  ).toBeVisible();

  const sendTest = page.getByRole("button", { name: "Send a test email" });
  await expect(sendTest).toBeDisabled();
});
