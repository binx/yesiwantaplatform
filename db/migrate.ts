import { backfillProductOptions } from "./admin-repository.js";
import { getDatabase } from "./client.js";
import { adoptAboutTextAsPage } from "./pages-repository.js";

/**
 * Apply pending migrations to whichever database DATABASE_URL points at.
 * Safe to run repeatedly; Drizzle tracks what has already been applied.
 *
 * Data steps run afterwards, here rather than in a SQL file: they have to
 * behave identically on SQLite and Postgres, and each one is written to be a
 * no-op on a database that has already had it. See `adoptAboutTextAsPage` and
 * `backfillProductOptions`.
 */
export async function runMigrations(): Promise<void> {
  const { raw, dialect } = await getDatabase();

  if (dialect === "sqlite") {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    migrate(raw as Parameters<typeof migrate>[0], {
      migrationsFolder: "./db/migrations/sqlite",
    });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(raw as Parameters<typeof migrate>[0], {
      migrationsFolder: "./db/migrations/pg",
    });
  }

  await adoptAboutTextAsPage();
  await backfillProductOptions();
}

// Allow `tsx db/migrate.ts` as well as importing it from the server.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied.");
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
