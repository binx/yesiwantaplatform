import { createApp } from "./app.js";
import { env } from "./env.js";
import { runMigrations } from "../db/migrate.js";
import { isConfigured } from "../db/repository.js";
import { activeSetupToken } from "./routes/setup.js";

/**
 * Boot.
 *
 * The server starts even when the store is unconfigured — it reports that
 * state over the API and the client shows a setup screen. v1 threw an
 * uncaught ENOENT on a missing config.env and never bound a port at all.
 */
async function main(): Promise<void> {
  await runMigrations();

  const app = createApp();

  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    console.log(`Beluga API listening on http://${env.API_HOST}:${env.API_PORT}`);
  });

  if (!(await isConfigured())) {
    console.log(
      "\n  This store is not set up yet. Either:\n" +
        "    npm run setup                 — three prompts in this terminal, or\n" +
        `    open ${env.PUBLIC_URL}/setup  — the same three steps in a browser\n`,
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

main().catch((error: unknown) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
