import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env, isSqlite } from "../server/env.js";
import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";

/**
 * One database handle, chosen by DATABASE_URL.
 *
 * `file:…` selects SQLite, which needs no server and is the default so that a
 * clone runs immediately. `postgres://…` selects Postgres for stores whose
 * inventory outgrows a single file — the reason item 6 exists.
 */

export type Dialect = "sqlite" | "pg";

/** A row as it comes back from either driver, before it is parsed with zod. */
export type Row = Record<string, unknown>;

/**
 * The slice of Drizzle's query builder the repository actually uses.
 *
 * The two dialects' builders are structurally identical but nominally
 * different, and TypeScript cannot unify them. Rather than typing the handle
 * as `any` — which would switch off every `no-unsafe-*` check in the data
 * layer — the surface is described here. Arguments are `unknown` because they
 * are opaque Drizzle objects; results are plain rows that callers narrow and
 * then validate with the shared zod schemas.
 */
export interface SelectBuilder extends PromiseLike<Row[]> {
  from(table: unknown): SelectBuilder;
  innerJoin(table: unknown, condition: unknown): SelectBuilder;
  where(condition?: unknown): SelectBuilder;
  orderBy(...columns: unknown[]): SelectBuilder;
  limit(count: number): SelectBuilder;
  offset(count: number): SelectBuilder;
}

export interface InsertBuilder extends PromiseLike<unknown> {
  values(values: unknown): InsertBuilder;
  onConflictDoUpdate(config: unknown): InsertBuilder;
  onConflictDoNothing(config?: unknown): InsertBuilder;
}

export interface UpdateBuilder extends PromiseLike<unknown> {
  set(values: unknown): UpdateBuilder;
  where(condition?: unknown): UpdateBuilder;
}

export interface DeleteBuilder extends PromiseLike<unknown> {
  where(condition?: unknown): DeleteBuilder;
}

export interface DrizzleLike {
  select(fields?: unknown): SelectBuilder;
  insert(table: unknown): InsertBuilder;
  update(table: unknown): UpdateBuilder;
  delete(table: unknown): DeleteBuilder;
}

export interface Database {
  dialect: Dialect;
  drizzle: DrizzleLike;
  schema: typeof sqliteSchema | typeof pgSchema;
  /** The raw handle, for the migrator, which needs the real driver type. */
  raw: unknown;
  close: () => Promise<void>;
}

let instance: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (instance) return instance;
  instance = isSqlite ? await createSqlite() : await createPostgres();
  return instance;
}

async function createSqlite(): Promise<Database> {
  const { default: BetterSqlite3 } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");

  const path = env.DATABASE_URL.replace(/^file:/, "");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const sqlite = new BetterSqlite3(path);
  // WAL keeps reads from blocking the writer, which matters as soon as a
  // storefront and an admin session are both active.
  sqlite.pragma("journal_mode = WAL");
  // SQLite does not enforce foreign keys unless asked, and the schema relies
  // on ON DELETE CASCADE to clean up variants and images.
  sqlite.pragma("foreign_keys = ON");

  const handle = drizzle(sqlite, { schema: sqliteSchema });

  return {
    dialect: "sqlite",
    drizzle: handle as unknown as DrizzleLike,
    schema: sqliteSchema,
    raw: handle,
    close: () => {
      sqlite.close();
      return Promise.resolve();
    },
  };
}

async function createPostgres(): Promise<Database> {
  const { default: pg } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const handle = drizzle(pool, { schema: pgSchema });

  return {
    dialect: "pg",
    drizzle: handle as unknown as DrizzleLike,
    schema: pgSchema,
    raw: handle,
    close: () => pool.end(),
  };
}

/** Test hook: drop the memoised handle so a fresh database can be opened. */
export async function resetDatabase(): Promise<void> {
  if (instance) await instance.close();
  instance = null;
}
