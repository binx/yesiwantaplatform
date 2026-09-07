import { randomUUID, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client.js";

/**
 * Admin authentication.
 *
 * v1 kept a bcrypt hash in `config.env` and had the server rewrite that file
 * at boot to persist it. Credentials live in the database here, and the
 * process never writes to its own configuration.
 */

// OWASP's argon2id baseline: 19 MiB, 2 iterations, 1 lane.
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

interface AdminRow {
  id: string;
  email: string;
  passwordHash: string;
}

/**
 * Verify a login.
 *
 * Always runs a hash comparison, even when the account does not exist, so
 * response time does not reveal which emails are registered.
 */
export async function verifyLogin(email: string, password: string): Promise<AdminRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email.toLowerCase().trim()))
    .limit(1)) as unknown as AdminRow[];

  const row = rows[0];

  if (!row) {
    // Decoy verify against a real hash of a throwaway value.
    await verify(DECOY_HASH, password).catch(() => false);
    return null;
  }

  const ok = await verify(row.passwordHash, password).catch(() => false);
  return ok ? row : null;
}

/**
 * A precomputed argon2id hash used only to equalise timing on unknown emails.
 * It is not a credential: nothing verifies against it successfully in practice.
 */
const DECOY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zdGF0aWMtc2FsdA$sJ0zR3B1Q1lVQmZmVGh1Y2tOb3RBUmVhbEhhc2g";

export async function createAdmin(email: string, password: string): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();

  const id = randomUUID();
  await db.insert(schema.adminUsers).values({
    id,
    email: email.toLowerCase().trim(),
    passwordHash: await hashPassword(password),
  });

  return id;
}

export async function countAdmins(): Promise<number> {
  const { drizzle: db, schema } = await getDatabase();
  const rows = (await db.select().from(schema.adminUsers).limit(1)) as unknown as AdminRow[];
  return rows.length;
}

/** Constant-time string comparison for CSRF tokens and similar secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
