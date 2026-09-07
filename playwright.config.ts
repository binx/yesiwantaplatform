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
    },
  },
});
