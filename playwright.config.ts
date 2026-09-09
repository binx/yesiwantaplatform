import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT) || 5173;
const API_PORT = Number(process.env.API_PORT) || 4000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Signs the e2e owner in once and saves its session cookie for every spec
  // that opts in via `test.use({ storageState: ADMIN_STORAGE_STATE })`.
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    /*
     * Locks the one shared store for the run of e2e/storefront-lock.spec.ts,
     * then restores it — see the comment at the top of that file. It has to
     * run with nothing else touching the storefront at the same time, and
     * `fullyParallel` schedules every other spec file onto its own worker
     * regardless of what any one file's own `describe.configure({ mode:
     * "serial" })` says, so file-local serialisation cannot provide that by
     * itself. `dependencies` is Playwright's project-level ordering — normally
     * used for an auth setup project — repurposed here to guarantee this
     * project starts, finishes, and unlocks the store before `chromium` or
     * `mobile` runs anything that assumes a public one.
     */
    {
      name: "storefront-lock",
      testMatch: /storefront-lock\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /storefront-lock\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["storefront-lock"],
    },
    {
      name: "mobile",
      testIgnore: /storefront-lock\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
      dependencies: ["storefront-lock"],
    },
  ],
  // The storefront reads from the API, so both have to be up.
  webServer: {
    command: "npm run dev:all",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      API_PORT: String(API_PORT),
      // Deliberately ignore the developer's .env so the suite is deterministic
      // — otherwise having Stripe keys locally changes what the tests see.
      ENV_FILE: ".env.e2e-does-not-exist",
      // Its own database, never the developer's `data/beluga.sqlite` — that
      // file's admin account and its password are whatever the developer's
      // machine happens to have, which `global-setup.ts` cannot sign into.
      // Delete `data/e2e.sqlite*` for a clean reseed; otherwise a local rerun
      // reuses it, the same way `reuseExistingServer` reuses the dev server.
      DATABASE_URL: "file:./data/e2e.sqlite",
      PUBLIC_URL: `http://localhost:${PORT}`,
      SESSION_SECRET: "e2e-session-secret-long-enough-to-satisfy-validation",
    },
  },
});
