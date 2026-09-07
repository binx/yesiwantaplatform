import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.pg.ts",
  out: "./db/migrations/pg",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/beluga",
  },
});
