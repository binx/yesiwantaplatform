import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, count, eq, isNull, like, ne, sql } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import type { AdminRole, AdminSummary } from "../shared/api.js";

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

/**
 * A duplicate email, raised as something a route can turn into a 409.
 *
 * `admin_users.email` is unique in both dialects, but the driver's error for a
 * violated constraint is shaped differently on each, so it is normalised here
 * rather than sniffed at every call site.
 */
export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`${email} already has an account.`);
    this.name = "EmailTakenError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // SQLITE_CONSTRAINT_UNIQUE, and Postgres's 23505.
  return /UNIQUE constraint failed|duplicate key value|23505/i.test(message);
}

export async function createAdmin(
  email: string,
  password: string,
  role: AdminRole = "owner",
): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();

  const id = randomUUID();
  const normalised = email.toLowerCase().trim();

  try {
    await db.insert(schema.adminUsers).values({
      id,
      email: normalised,
      role,
      passwordHash: await hashPassword(password),
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailTakenError(normalised);
    throw error;
  }

  return id;
}

/** Timestamps are unix seconds on SQLite and a Date on Postgres. */
function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value * 1000;
  return null;
}

/**
 * Every administrator, without their hashes.
 *
 * The columns are named explicitly rather than `select()`-ing the row: a
 * `passwordHash` reaching a response is the failure this whole module exists to
 * prevent, and a narrowed select makes it impossible rather than unlikely.
 */
export async function listAdmins(currentId: string): Promise<AdminSummary[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      id: schema.adminUsers.id,
      email: schema.adminUsers.email,
      role: schema.adminUsers.role,
      lastLoginAt: schema.adminUsers.lastLoginAt,
      createdAt: schema.adminUsers.createdAt,
    })
    .from(schema.adminUsers)
    .orderBy(schema.adminUsers.createdAt)) as unknown as {
    id: string;
    email: string;
    role: string;
    lastLoginAt: unknown;
    createdAt: unknown;
  }[];

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role === "staff" ? "staff" : "owner",
    lastLoginAt: toEpochMs(row.lastLoginAt),
    createdAt: toEpochMs(row.createdAt) ?? Date.now(),
    isSelf: row.id === currentId,
  }));
}

export async function findAdminById(
  id: string,
): Promise<{ id: string; email: string; role: AdminRole } | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      id: schema.adminUsers.id,
      email: schema.adminUsers.email,
      role: schema.adminUsers.role,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, id))
    .limit(1)) as unknown as { id: string; email: string; role: string }[];

  const row = rows[0];
  return row
    ? { id: row.id, email: row.email, role: row.role === "staff" ? "staff" : "owner" }
    : null;
}

export async function emailIsTaken(email: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email.toLowerCase().trim()))
    .limit(1)) as unknown as { id: string }[];

  return rows.length > 0;
}

export async function countOwners(): Promise<number> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ value: count() })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.role, "owner"))) as unknown as { value: number }[];

  return rows[0]?.value ?? 0;
}

export async function deleteAdmin(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, id));
}

/**
 * Change a password, having already checked the current one.
 *
 * Verification is the caller's job because the route also rate-limits it; this
 * function must never be reachable without that check.
 */
export async function updateAdminPassword(id: string, password: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .update(schema.adminUsers)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(schema.adminUsers.id, id));
}

export async function verifyPasswordFor(id: string, password: string): Promise<boolean> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ passwordHash: schema.adminUsers.passwordHash })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, id))
    .limit(1)) as unknown as { passwordHash: string }[];

  const row = rows[0];
  if (!row) {
    await verify(DECOY_HASH, password).catch(() => false);
    return false;
  }

  return verify(row.passwordHash, password).catch(() => false);
}

/* ----------------------------------------------------------------- invites */

export interface PendingInvite {
  id: string;
  email: string;
  role: AdminRole;
}

/**
 * Create an invitation, returning the raw token exactly once.
 *
 * Only the hash is stored. This is the same reasoning as a password reset: the
 * link in someone's inbox is a credential, and a database dump must not be one.
 */
export async function createInvite(
  email: string,
  role: AdminRole,
): Promise<{ id: string; token: string }> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await db.insert(schema.adminInvites).values({
    id,
    email: email.toLowerCase().trim(),
    role,
    tokenHash: hashToken(token),
    expiresAt: dialect === "pg" ? expiresAt : Math.floor(expiresAt.getTime() / 1000),
  });

  return { id, token };
}

/** 72 hours: long enough to survive a weekend, short enough to expire. */
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * SHA-256 rather than argon2: the token is 256 bits of entropy we generated,
 * not a human-chosen password, so there is nothing for a slow hash to defend.
 *
 * Exported so the customer email-verification and password-reset tokens below
 * share this rather than a second implementation of the same reasoning.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class InviteNotUsableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteNotUsableError";
  }
}

/**
 * Redeem an invitation.
 *
 * The lookup is by token hash, so a tampered token simply finds nothing. The
 * invite is marked accepted with a conditional update before the account is
 * created — claiming first means two simultaneous accepts cannot both win.
 */
export async function acceptInvite(token: string, password: string): Promise<string> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const rows = (await db
    .select()
    .from(schema.adminInvites)
    .where(eq(schema.adminInvites.tokenHash, hashToken(token)))
    .limit(1)) as unknown as {
    id: string;
    email: string;
    role: string;
    expiresAt: unknown;
    acceptedAt: unknown;
  }[];

  const invite = rows[0];
  if (!invite) throw new InviteNotUsableError("That invitation is not valid.");

  if (invite.acceptedAt !== null && invite.acceptedAt !== undefined) {
    throw new InviteNotUsableError("That invitation has already been used.");
  }
  if ((toEpochMs(invite.expiresAt) ?? 0) < Date.now()) {
    throw new InviteNotUsableError("That invitation has expired. Ask for a new one.");
  }

  /*
   * Checked before the invite is claimed, so an address that gained an account
   * in the meantime does not also burn the invitation on its way to failing.
   *
   * Deliberately after the used/expired checks: a second use of one invitation
   * is a spent invitation, not a name clash, and should say so.
   */
  if (await emailIsTaken(invite.email)) {
    throw new EmailTakenError(invite.email);
  }

  const now = new Date();
  const claim = await db
    .update(schema.adminInvites)
    .set({ acceptedAt: dialect === "pg" ? now : Math.floor(now.getTime() / 1000) })
    .where(and(eq(schema.adminInvites.id, invite.id), isNull(schema.adminInvites.acceptedAt)));

  const changed = (claim as { changes?: number; rowCount?: number } | null) ?? {};
  if ((changed.changes ?? changed.rowCount ?? 0) !== 1) {
    throw new InviteNotUsableError("That invitation has already been used.");
  }

  return createAdmin(invite.email, password, invite.role === "owner" ? "owner" : "staff");
}

/** Invitations that have not been used and have not run out. */
export async function listPendingInvites(): Promise<PendingInvite[]> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      id: schema.adminInvites.id,
      email: schema.adminInvites.email,
      role: schema.adminInvites.role,
      expiresAt: schema.adminInvites.expiresAt,
    })
    .from(schema.adminInvites)
    .where(isNull(schema.adminInvites.acceptedAt))) as unknown as {
    id: string;
    email: string;
    role: string;
    expiresAt: unknown;
  }[];

  return rows
    .filter((row) => (toEpochMs(row.expiresAt) ?? 0) >= Date.now())
    .map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role === "owner" ? ("owner" as const) : ("staff" as const),
    }));
}

export async function revokeInvite(id: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.delete(schema.adminInvites).where(eq(schema.adminInvites.id, id));
}

/**
 * Sign out every session belonging to one administrator.
 *
 * Without this, removing an employee leaves them signed in until their cookie
 * expires, which is most of the point of removing them. The session payload is
 * JSON in a text column, so the match is on the serialised `adminId` — the id
 * is a UUID, so there is nothing else in the blob it could collide with.
 */
export async function destroySessionsForUser(
  adminId: string,
  options: { except?: string } = {},
): Promise<void> {
  await destroySessionsMatching(`%"adminId":"${adminId}"%`, options.except);
}

/**
 * The customer-side twin, for a password reset: the person resetting is
 * usually the person who suspects someone else is signed in as them.
 */
export async function destroySessionsForCustomer(customerId: string): Promise<void> {
  await destroySessionsMatching(`%"customerId":"${customerId}"%`);
}

/** `except` keeps one session — the one that just proved it knows the password. */
async function destroySessionsMatching(pattern: string, except?: string): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();

  await db
    .delete(schema.sessions)
    .where(
      and(
        like(schema.sessions.data, sql`${pattern}`),
        except ? ne(schema.sessions.sid, except) : undefined,
      ),
    );
}

/**
 * Issue a password-reset token for an administrator's email, if one holds it.
 *
 * Same shape as the customer equivalent below: null for an unknown email
 * rather than a throw, because the route must answer identically either way.
 * The miss branch runs the same decoy argon2 verify `verifyLogin` uses, so a
 * timing measurement cannot tell a known admin email from an unknown one —
 * the hit branch's own work (a token hash and a write) is otherwise the
 * cheaper path.
 */
export async function createAdminPasswordResetToken(email: string): Promise<string | null> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const rows = (await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email.toLowerCase().trim()))
    .limit(1)) as unknown as { id: string }[];

  const row = rows[0];
  if (!row) {
    await verify(DECOY_HASH, email).catch(() => false);
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await db
    .update(schema.adminUsers)
    .set({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpiresAt: dialect === "pg" ? expiresAt : Math.floor(expiresAt.getTime() / 1000),
    })
    .where(eq(schema.adminUsers.id, row.id));

  return token;
}

/**
 * Redeem an administrator's password-reset token. Single-use, exactly like
 * `consumePasswordResetToken` below. Returns the admin id so the route can
 * destroy their other sessions — the same behaviour `updateAdminPassword`'s
 * route already has.
 */
export async function consumeAdminPasswordResetToken(
  token: string,
  password: string,
): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();
  const tokenHash = hashToken(token);

  const rows = (await db
    .select({
      id: schema.adminUsers.id,
      passwordResetExpiresAt: schema.adminUsers.passwordResetExpiresAt,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.passwordResetTokenHash, tokenHash))
    .limit(1)) as unknown as { id: string; passwordResetExpiresAt: unknown }[];

  const row = rows[0];
  if (!row) throw new TokenNotUsableError("That reset link is not valid.");
  if ((toEpochMs(row.passwordResetExpiresAt) ?? 0) < Date.now()) {
    throw new TokenNotUsableError("That reset link has expired. Request a new one.");
  }

  const claim = await db
    .update(schema.adminUsers)
    .set({
      passwordHash: await hashPassword(password),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    })
    .where(and(eq(schema.adminUsers.id, row.id), eq(schema.adminUsers.passwordResetTokenHash, tokenHash)));

  const changed = (claim as { changes?: number; rowCount?: number } | null) ?? {};
  if ((changed.changes ?? changed.rowCount ?? 0) !== 1) {
    throw new TokenNotUsableError("That reset link has already been used.");
  }

  return row.id;
}

/** Stamp a successful sign-in, for the staff list. */
export async function recordLogin(id: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const now = new Date();

  await db
    .update(schema.adminUsers)
    .set({ lastLoginAt: dialect === "pg" ? now : Math.floor(now.getTime() / 1000) })
    .where(eq(schema.adminUsers.id, id));
}

/**
 * How many administrators exist.
 *
 * Actually counts. It used to `select().limit(1)` and return the row count,
 * so it answered 1 for any populated table — fine for its `> 0` callers, but
 * `setup.test.ts` asserts that a race creates *exactly one* administrator, and
 * against the capped version that assertion could not have failed.
 */
export async function countAdmins(): Promise<number> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({ value: count() })
    .from(schema.adminUsers)) as unknown as { value: number }[];

  return rows[0]?.value ?? 0;
}

/** Constant-time string comparison for CSRF tokens and similar secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* -------------------------------------------------------------- customers */

/**
 * Storefront customer accounts.
 *
 * A separate table from `admin_users` and a separate session flag
 * (`customerId`, never `adminId`) — see the security posture in
 * docs/tasks/11-customer-accounts.md. The hashing and token machinery below
 * is the same code the admin path above uses; nothing here reimplements it.
 */

export interface CustomerAuthRow {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Create a customer account.
 *
 * A normal write on its own, but the *route* above this must respond
 * identically whether the email was already taken — see the register route,
 * which never lets this function's `EmailTakenError` reach the client.
 */
export async function createCustomer(
  email: string,
  password: string,
  name: string | null,
): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();

  const id = randomUUID();
  const normalised = email.toLowerCase().trim();

  try {
    await db.insert(schema.customers).values({
      id,
      email: normalised,
      name,
      passwordHash: await hashPassword(password),
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailTakenError(normalised);
    throw error;
  }

  return id;
}

interface CustomerLoginRow extends CustomerAuthRow {
  passwordHash: string | null;
}

/**
 * Verify a customer's credentials.
 *
 * Same shape as `verifyLogin`: a decoy hash runs whenever there is no
 * account, or an account with no password on it yet, so response time never
 * discloses which emails are registered.
 */
export async function verifyCustomerLogin(
  email: string,
  password: string,
): Promise<CustomerAuthRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      id: schema.customers.id,
      email: schema.customers.email,
      name: schema.customers.name,
      passwordHash: schema.customers.passwordHash,
    })
    .from(schema.customers)
    .where(eq(schema.customers.email, email.toLowerCase().trim()))
    .limit(1)) as unknown as CustomerLoginRow[];

  const row = rows[0];

  if (!row || !row.passwordHash) {
    await verify(DECOY_HASH, password).catch(() => false);
    return null;
  }

  const ok = await verify(row.passwordHash, password).catch(() => false);
  return ok ? { id: row.id, email: row.email, name: row.name } : null;
}

export interface CustomerProfileRow {
  id: string;
  email: string;
  name: string | null;
  emailVerifiedAt: unknown;
  createdAt: unknown;
}

export async function findCustomerById(id: string): Promise<CustomerProfileRow | null> {
  const { drizzle: db, schema } = await getDatabase();

  const rows = (await db
    .select({
      id: schema.customers.id,
      email: schema.customers.email,
      name: schema.customers.name,
      emailVerifiedAt: schema.customers.emailVerifiedAt,
      createdAt: schema.customers.createdAt,
    })
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1)) as unknown as CustomerProfileRow[];

  return rows[0] ?? null;
}

export async function updateCustomerName(id: string, name: string | null): Promise<void> {
  const { drizzle: db, schema } = await getDatabase();
  await db.update(schema.customers).set({ name }).where(eq(schema.customers.id, id));
}

/** Stamp a successful sign-in. Best-effort at the call site, as with admins. */
export async function recordCustomerLogin(id: string): Promise<void> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const now = new Date();

  await db
    .update(schema.customers)
    .set({ lastLoginAt: dialect === "pg" ? now : Math.floor(now.getTime() / 1000) })
    .where(eq(schema.customers.id, id));
}

/** A token that once existed but no longer applies: spent, expired, or never real. */
export class TokenNotUsableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenNotUsableError";
  }
}

/** Generous: this is an onboarding step, not a live credential. */
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** An hour: a reset link *is* a live credential, so it does not linger. */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** Issue an email-verification token, returning the raw value exactly once. */
export async function createEmailVerificationToken(customerId: string): Promise<string> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);

  await db
    .update(schema.customers)
    .set({
      emailVerifyTokenHash: hashToken(token),
      emailVerifyExpiresAt: dialect === "pg" ? expiresAt : Math.floor(expiresAt.getTime() / 1000),
    })
    .where(eq(schema.customers.id, customerId));

  return token;
}

/**
 * Redeem an email-verification token.
 *
 * Marks the address verified and clears the token in one conditional update,
 * so two requests racing on the same link cannot both succeed. Deliberately
 * does not claim any orders itself — that is the caller's job once this has
 * actually succeeded, which is what keeps verification the one gate an
 * unverified registration cannot walk around.
 */
export async function consumeEmailVerificationToken(
  token: string,
): Promise<{ id: string; email: string }> {
  const { drizzle: db, schema, dialect } = await getDatabase();
  const tokenHash = hashToken(token);

  const rows = (await db
    .select({
      id: schema.customers.id,
      email: schema.customers.email,
      emailVerifyExpiresAt: schema.customers.emailVerifyExpiresAt,
    })
    .from(schema.customers)
    .where(eq(schema.customers.emailVerifyTokenHash, tokenHash))
    .limit(1)) as unknown as { id: string; email: string; emailVerifyExpiresAt: unknown }[];

  const row = rows[0];
  if (!row) throw new TokenNotUsableError("That verification link is not valid.");
  if ((toEpochMs(row.emailVerifyExpiresAt) ?? 0) < Date.now()) {
    throw new TokenNotUsableError("That verification link has expired. Request a new one.");
  }

  const now = new Date();
  const claim = await db
    .update(schema.customers)
    .set({
      emailVerifiedAt: dialect === "pg" ? now : Math.floor(now.getTime() / 1000),
      emailVerifyTokenHash: null,
      emailVerifyExpiresAt: null,
    })
    .where(and(eq(schema.customers.id, row.id), eq(schema.customers.emailVerifyTokenHash, tokenHash)));

  const changed = (claim as { changes?: number; rowCount?: number } | null) ?? {};
  if ((changed.changes ?? changed.rowCount ?? 0) !== 1) {
    throw new TokenNotUsableError("That verification link has already been used.");
  }

  return { id: row.id, email: row.email };
}

/**
 * Issue a password-reset token for an email, if an account holds it.
 *
 * Returns null for an unknown email rather than throwing: the route must
 * answer identically either way, so it — not this function — decides what a
 * null means.
 */
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const { drizzle: db, schema, dialect } = await getDatabase();

  const rows = (await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.email, email.toLowerCase().trim()))
    .limit(1)) as unknown as { id: string }[];

  const row = rows[0];
  if (!row) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await db
    .update(schema.customers)
    .set({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpiresAt: dialect === "pg" ? expiresAt : Math.floor(expiresAt.getTime() / 1000),
    })
    .where(eq(schema.customers.id, row.id));

  return token;
}

/**
 * Redeem a password-reset token. Single-use, exactly like the invite tokens
 * above. Returns the customer id so the route can sign their other sessions out.
 */
export async function consumePasswordResetToken(token: string, password: string): Promise<string> {
  const { drizzle: db, schema } = await getDatabase();
  const tokenHash = hashToken(token);

  const rows = (await db
    .select({
      id: schema.customers.id,
      passwordResetExpiresAt: schema.customers.passwordResetExpiresAt,
    })
    .from(schema.customers)
    .where(eq(schema.customers.passwordResetTokenHash, tokenHash))
    .limit(1)) as unknown as { id: string; passwordResetExpiresAt: unknown }[];

  const row = rows[0];
  if (!row) throw new TokenNotUsableError("That reset link is not valid.");
  if ((toEpochMs(row.passwordResetExpiresAt) ?? 0) < Date.now()) {
    throw new TokenNotUsableError("That reset link has expired. Request a new one.");
  }

  const claim = await db
    .update(schema.customers)
    .set({
      passwordHash: await hashPassword(password),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    })
    .where(and(eq(schema.customers.id, row.id), eq(schema.customers.passwordResetTokenHash, tokenHash)));

  const changed = (claim as { changes?: number; rowCount?: number } | null) ?? {};
  if ((changed.changes ?? changed.rowCount ?? 0) !== 1) {
    throw new TokenNotUsableError("That reset link has already been used.");
  }

  return row.id;
}
