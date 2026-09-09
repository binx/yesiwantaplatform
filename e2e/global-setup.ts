import { request as playwrightRequest, type FullConfig } from "@playwright/test";
import { demoStore } from "../shared/demo-store.js";
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_STORAGE_STATE } from "./fixtures/admin.js";

/**
 * Signs the e2e owner account in once, before any spec runs, and saves the
 * resulting session cookie to disk.
 *
 * The account is created (or, on a rerun against a database this suite has
 * already seeded, just signed into) through the same API the setup wizard and
 * login form use — never a real browser typing a password into either
 * screen. That is the point: it lets admin specs start already signed in,
 * without ever asking a person (or an agent that refuses to) to hand over
 * credentials interactively. `POST /setup` also seeds the demo catalogue in
 * the same call, so the storefront specs get deterministic products instead
 * of depending on whatever is already in the database.
 *
 * Idempotent: a store that is already configured (a second local run reusing
 * the same e2e database) skips straight to signing in with the same fixture
 * credentials rather than failing on setup's 410.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) throw new Error("e2e global setup: no baseURL configured.");

  const api = await playwrightRequest.newContext({ baseURL });

  try {
    const { csrfToken, isConfigured } = await waitForSession(api);

    if (!isConfigured) {
      const setup = await api.post("/api/setup", {
        headers: { "x-csrf-token": csrfToken },
        data: {
          storeName: demoStore.name,
          currency: demoStore.currency,
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          stripePublishableKey: demoStore.stripePublishableKey,
          theme: demoStore.theme,
          seedDemo: true,
        },
      });

      if (!setup.ok()) {
        throw new Error(`e2e setup failed: ${setup.status()} ${await setup.text()}`);
      }
    } else {
      const login = await api.post("/api/session", {
        headers: { "x-csrf-token": csrfToken },
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });

      if (!login.ok()) {
        throw new Error(`e2e admin login failed: ${login.status()} ${await login.text()}`);
      }
    }

    await api.storageState({ path: ADMIN_STORAGE_STATE });
  } finally {
    await api.dispose();
  }
}

/**
 * `webServer`'s readiness check only waits for the Vite dev server to answer
 * — `npm run dev:all` starts it alongside the API, not after it, so the very
 * first request or two can land while Vite is up but its proxy to the API has
 * nothing to reach yet and answers 502. Retried rather than added to the
 * `webServer` health check itself, since that check has no way to name a
 * second port to wait on without also gating every non-admin spec on it.
 */
async function waitForSession(
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
): Promise<{ csrfToken: string; isConfigured: boolean }> {
  const attempts = 20;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await api.get("/api/session");
    const body = await response.text();

    if (response.ok()) {
      return JSON.parse(body) as { csrfToken: string; isConfigured: boolean };
    }

    if (attempt === attempts) {
      throw new Error(`e2e session check failed: ${response.status()} ${body}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("unreachable");
}
