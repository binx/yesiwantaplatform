import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { createApp } from "./app.js";
import { env, hasLob, hasStripe, lobMode } from "./env.js";
import { ASSETS_ROOT } from "./uploads.js";
import { imageStore } from "./image-store.js";
import { runMigrations } from "../db/migrate.js";
import { isConfigured } from "../db/repository.js";
import { activeSetupToken } from "./routes/setup.js";
import { probeStripeKey } from "./stripe.js";

/**
 * Boot.
 *
 * The server starts even when the platform is unconfigured — it reports that
 * state over the API and the client shows a setup screen.
 */
async function main(): Promise<void> {
  await runMigrations();
  if (imageStore.driver === "local") await ensureAssetsDirectory();

  // Not awaited: a slow or unreachable Stripe should not delay the API
  // binding its port. Until this resolves, `stripeKeyStatus` reads
  // "unchecked" — see server/stripe.ts.
  void probeStripeKey();

  const app = createApp();

  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    console.log(`Yes I Want A Postcard API listening on http://${env.API_HOST}:${env.API_PORT}`);
    console.log(
      hasLob
        ? `Printing: Lob, ${lobMode} key${env.LOB_BACK_TEMPLATE_ID ? ` with back template ${env.LOB_BACK_TEMPLATE_ID}` : ", back rendered from print/back.hbs"}`
        : "Printing: LOB_API_KEY is not set, so mailed postcards will wait at Scheduled.",
    );
    console.log(hasStripe ? "Billing: Stripe, subscriptions and Connect payouts." : "Billing: STRIPE_SECRET_KEY is not set, so nobody can subscribe and nothing is paid out.");
    // Where uploads go, in the deploy log, next to where the API is: the two
    // things an operator checks first when a deploy looks wrong.
    console.log(imageStore.describe());
  });

  if (!(await isConfigured())) {
    console.log(
      "\n  This platform is not set up yet. Either:\n" +
        "    npm run setup                 — a few prompts in this terminal, or\n" +
        `    open ${env.PUBLIC_URL}/setup  — the same steps in a browser\n`,
    );

    /*
     * Until setup completes, POST /api/setup will create an administrator for
     * whoever calls it. On a machine nobody else can reach that is fine; on a
     * public address it is a race the operator has to win against every scanner
     * on the internet. So in production the wizard also asks for this — it is
     * only ever printed here, where only the operator can read it.
     */
    const token = activeSetupToken();
    if (token) {
      console.log(
        env.SETUP_TOKEN
          ? "  The wizard will ask for the SETUP_TOKEN from the environment.\n"
          : `  The wizard will ask for this setup token:\n\n    ${token}\n\n` +
              "  It is not stored anywhere; a restart prints a new one.\n",
      );
    }
  }

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * Make the upload directory exist and say so if it cannot be written.
 *
 * A volume mounted at the wrong path, or owned by the wrong user, otherwise
 * shows up as a 500 on the first image upload — hours after the deploy, to
 * an artist who has no way to connect the two. A warning here, not a crash.
 */
async function ensureAssetsDirectory(): Promise<void> {
  try {
    await mkdir(ASSETS_ROOT, { recursive: true });
    await access(ASSETS_ROOT, constants.W_OK);
  } catch (error) {
    console.warn(
      `Uploads will fail: ${ASSETS_ROOT} is not writable (${(error as Error).message}). ` +
        "Check ASSETS_DIR and the directory's owner.",
    );
  }
}

main().catch((error: unknown) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
