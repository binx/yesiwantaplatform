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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
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
      // Its own database, never the developer's `data/postcards.sqlite` — that
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
