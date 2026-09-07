import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.sqlite.ts",
  out: "./db/migrations/sqlite",
  dbCredentials: {
    url: (process.env.DATABASE_URL ?? "file:./data/beluga.sqlite").replace(/^file:/, ""),
  },
});
