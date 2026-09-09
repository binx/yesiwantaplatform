import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { createApp } from "./app.js";
import { env } from "./env.js";
import { ASSETS_ROOT } from "./uploads.js";
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
  await ensureAssetsDirectory();

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

/**
 * Make the upload directory exist and say so if it cannot be written.
 *
 * A volume mounted at the wrong path, or owned by the wrong user, otherwise
 * shows up as a 500 on the first image upload — hours after the deploy, to a
 * merchant who has no way to connect the two. A warning here, not a crash:
 * a store with a broken image directory still browses and still sells, and
 * the operator reads the log either way.
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
