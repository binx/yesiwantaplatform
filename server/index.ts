import { createApp } from "./app.js";
import { env } from "./env.js";
import { runMigrations } from "../db/migrate.js";
import { isConfigured } from "../db/repository.js";

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

  const server = app.listen(env.API_PORT, () => {
    console.log(`Beluga API listening on http://localhost:${env.API_PORT}`);
  });

  if (!(await isConfigured())) {
    console.log(
      "\n  This store is not set up yet. Either:\n" +
        "    npm run setup                 — three prompts in this terminal, or\n" +
        `    open ${env.PUBLIC_URL}/setup  — the same three steps in a browser\n`,
    );
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
