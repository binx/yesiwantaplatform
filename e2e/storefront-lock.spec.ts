import { devices, expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./fixtures/admin";

/**
 * The storefront password gate — see docs/tasks/27-storefront-preview-mode.md.
 *
 * Locks the one shared store for the run of this file, then restores it in
 * `afterAll`. Runs in its own Playwright project (see playwright.config.ts),
 * which the `chromium` and `mobile` projects depend on: `fullyParallel`
 * schedules every other spec file onto its own worker regardless of what this
 * file's own `describe.configure({ mode: "serial" })` says, and a project
 * dependency is what actually stops `storefront.spec.ts` (say) from browsing
 * the storefront anonymously while this file has it locked.
 *
 * Both widths are covered inside a single test, by opening two browser
 * contexts with different viewports — not by also running under the `mobile`
 * project, which would lock and unlock the shared store a second time.
 *
 * `ENV_FILE` points at a file that does not exist (see playwright.config.ts),
 * so — like every other setting — this has to go through the database via
 * the admin API rather than the environment.
 */
test.describe("storefront lock", () => {
  test.describe.configure({ mode: "serial" });

  const STOREFRONT_PASSWORD = "e2e-storefront-password-fixture";

  test.beforeAll(async ({ browser }) => {
    const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const session = await admin.request.get("/api/session");
    const { csrfToken } = (await session.json()) as { csrfToken: string };

    await admin.request.put("/api/admin/storefront/password", {
      headers: { "x-csrf-token": csrfToken },
      data: { password: STOREFRONT_PASSWORD },
    });
    await admin.request.put("/api/admin/storefront", {
      headers: { "x-csrf-token": csrfToken },
      data: { access: "password" },
    });

    await admin.close();
  });

  test.afterAll(async ({ browser }) => {
    const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const session = await admin.request.get("/api/session");
    const { csrfToken } = (await session.json()) as { csrfToken: string };

    // Clearing the password also resets access to "public" — see
    // `clearStorefrontPassword` in db/admin-repository.ts — which is what
    // leaves the fixture the way every other spec in this suite expects it.
    await admin.request.delete("/api/admin/storefront/password", {
      headers: { "x-csrf-token": csrfToken },
    });

    await admin.close();
  });

  test("locked landing page unlocks with the password, at both widths", async ({ browser }) => {
    for (const viewport of [{ width: 1280, height: 800 }, devices["Pixel 7"].viewport]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      await page.goto("/");

      await expect(page.getByRole("heading", { name: "This store is not open yet" })).toBeVisible();
      // The rest of the storefront must not have rendered underneath the gate.
      await expect(page.getByRole("heading", { name: "Beluga Demo" })).not.toBeVisible();

      await page.getByPlaceholder("Password").fill(STOREFRONT_PASSWORD);
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page.getByRole("heading", { name: "Beluga Demo", level: 1 })).toBeVisible();

      await page.getByRole("link", { name: "Shop everything" }).click();
      await expect(page).toHaveURL(/\/shop$/);
      await expect(page.getByRole("link", { name: /Canvas Tote/ }).first()).toBeVisible();

      await context.close();
    }
  });

  test("rejects the wrong password", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Password").fill("not-the-right-password");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Incorrect password.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Beluga Demo" })).not.toBeVisible();
  });

  test("a share link unlocks the store and strips the token from the address bar", async ({
    browser,
    page,
  }) => {
    const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
    const session = await admin.request.get("/api/session");
    const { csrfToken } = (await session.json()) as { csrfToken: string };

    const created = await admin.request.post("/api/admin/storefront/share-link", {
      headers: { "x-csrf-token": csrfToken },
      data: {},
    });
    const { url } = (await created.json()) as { url: string };

    const token = new URL(url).searchParams.get("preview");
    expect(token).toBeTruthy();

    await page.goto(`/?preview=${token}`);

    await expect(page.getByRole("heading", { name: "Beluga Demo", level: 1 })).toBeVisible();
    await expect(page).toHaveURL("/");

    // Revoked so this test leaves no share link behind for a later run (or
    // the accessibility sweep's Settings page) to find — the same reason
    // `settings.spec.ts` restores the fields it edits.
    await admin.request.delete("/api/admin/storefront/share-link", {
      headers: { "x-csrf-token": csrfToken },
    });
    await admin.close();
  });
});
