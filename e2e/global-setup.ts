import { request as playwrightRequest, type FullConfig } from "@playwright/test";
import { demoStore } from "../shared/demo-store.js";
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_STORAGE_STATE } from "./fixtures/admin.js";

/**
 * Signs the e2e owner account in once, before any spec runs, and saves the
 * resulting session cookie to disk. Idempotent: a store that is already
 * configured skips straight to signing in.
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
          stripePublishableKey: null,
          theme: demoStore.theme,
        },
      });
      if (!setup.ok()) throw new Error(`e2e setup failed: ${setup.status()} ${await setup.text()}`);
    } else {
      const login = await api.post("/api/session", {
        headers: { "x-csrf-token": csrfToken },
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
      if (!login.ok()) throw new Error(`e2e admin login failed: ${login.status()} ${await login.text()}`);
    }

    await api.storageState({ path: ADMIN_STORAGE_STATE });
  } finally {
    await api.dispose();
  }
}

async function waitForSession(api: Awaited<ReturnType<typeof playwrightRequest.newContext>>) {
  const attempts = 20;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await api.get("/api/session");
    const body = await response.text();
    if (response.ok()) return JSON.parse(body) as { csrfToken: string; isConfigured: boolean };
    if (attempt === attempts) throw new Error(`e2e session check failed: ${response.status()} ${body}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("unreachable");
}
