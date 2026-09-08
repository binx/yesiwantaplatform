---
task: "07"
title: Staff accounts
status: done
tier: 1
size: M
migration: one column
blocked_by: []
blocks: []
touches: server/auth.ts:82 · server/routes/admin.ts · server/security.test.ts
completed: 2026-09-07
shipped_in: 1b23e8c
summary: >-
  Only `npm run setup` and the setup wizard ever create an account, and there is no route
  to add a second — so a two-person shop shares one password. The machinery is already
  built: argon2id hashing, database-backed sessions, and `countAdmins` all live in
  `server/auth.ts`, and the email layer can carry an invite. Add CRUD under the existing
  `requireAdmin` router and a `role` column if you want anything finer than full access.
---

# 07 · Staff accounts

## The problem

An admin account is created in exactly two places — `npm run setup`
(`scripts/setup.ts`) and the setup wizard (`server/routes/setup.ts:119`) — and
both refuse to run once one exists. There is **no route to add a second account
and no UI to manage them.** A two-person shop shares one password, and there is
no way to revoke access when someone leaves.

## What already exists

Most of the machinery. Read `server/auth.ts` first:

- `createAdmin(email, password)` — argon2id hashing, already used by the seed and
  the wizard.
- `countAdmins()` at `server/auth.ts:82`.
- Database-backed sessions (`server/session-store.ts`), `requireAdmin` and
  `verifyCsrf` (`server/middleware.ts:76`, `:100`).
- A working transactional email layer (`server/email.ts`) — though note it is
  currently **order-shaped**: `sendOrderEmail` takes an `Order`. An invite needs
  a second, more general send path.

## What to build

### 1. Schema — both dialects

Add to `adminUsers` (`db/schema.sqlite.ts:37` and the pg equivalent):

```ts
/** "owner" | "staff". The last owner cannot be removed or demoted. */
role: text("role").notNull().default("owner"),
```

Default `"owner"` so existing single-admin installs migrate to owner, not staff.

**Decide deliberately whether roles gate anything.** The honest options:

- **A.** `role` is a label only; every admin can do everything. Ship this.
- **B.** `staff` cannot manage other users, change Stripe settings, or issue
  refunds.

Take **A** for this brief. B multiplies the permission surface across every route
and needs its own security-test matrix; it is a separate decision. Still add the
column now so B doesn't need a second migration. Say in the UI that staff have
full access.

### 2. Auth functions

In `server/auth.ts`:

```ts
export async function listAdmins(): Promise<AdminSummary[]>   // id, email, role, lastLoginAt, createdAt — never the hash
export async function deleteAdmin(id: string): Promise<void>
export async function updateAdminPassword(id: string, password: string): Promise<void>
```

`AdminSummary` goes in `shared/api.ts`. **The password hash must never leave the
server** — v1 stored its hash in a `config.env` that was served to the client.

### 3. Routes

In `server/routes/admin.ts`, a new section:

```
GET    /api/admin/users              200: AdminSummary[]
POST   /api/admin/users              body: { email, role }        201: { id, inviteUrl? }
DELETE /api/admin/users/:id          204
PUT    /api/admin/users/me/password  body: { current, next }      204
```

Rules, all of which need a test:

- **You cannot delete yourself.** 409, "You cannot remove your own account."
- **You cannot delete the last owner.** Use `countAdmins()`. 409.
- Deleting a user must **destroy their sessions**. Sessions live in the
  `sessions` table with the payload in a `data` column
  (`db/schema.sqlite.ts:47`); add a `destroySessionsForUser(userId)` to
  `server/session-store.ts`. If the stored payload does not currently carry the
  user id, add it at login (`server/routes/session.ts`) — otherwise a removed
  employee stays signed in until their cookie expires, which defeats the point.
- Changing a password requires the current one, verified with the same argon2
  path as login, and rate-limited with `loginRateLimit`
  (`server/middleware.ts:51`) rather than `writeRateLimit`.
- Duplicate email → 409 with a clear message. `adminUsers.email` is already
  unique, so catch the constraint violation; the error shape differs between
  SQLite and Postgres, so map both.

### 4. Invites

Two viable shapes. **Take the second.**

- ~~Set a password for them~~ — means an admin knows another's password.
- **A single-use invite token.** Add an `admin_invites` table (`id`, `email`,
  `tokenHash`, `role`, `expiresAt`, `acceptedAt`). Store a **hash** of the token,
  never the token; send the raw token in the link, exactly as a password reset
  would work. 72-hour expiry. Accepting it creates the admin and marks the invite
  used, in that order, and re-accepting is a 410.

`POST /api/admin/users` sends the invite email and returns `inviteUrl` **only
when SMTP is not configured** (`isEmailConfigured()` at `server/email.ts:27`), so
a self-hosted store without email can still add a colleague by copying the link.
Log it the same way `server/email.ts:114` logs a would-be send.

The accept route is **public** — it must live in `server/routes/setup.ts` or its
own router, not the admin router, because the invitee is not yet authenticated.
Rate-limit it and make the token comparison timing-safe
(`crypto.timingSafeEqual`).

### 5. Admin UI

A new `src/admin/UsersPage.tsx` plus a route in `src/router.tsx:83` alongside
Settings, and hooks in `src/admin/queries.ts`. Table of users, an invite form, a
remove action with confirmation, and a change-password form for the current user.
Follow the layout and CSS-module conventions of `src/admin/SettingsPage.tsx`.

## Acceptance

- A second admin can be invited, accept, and sign in.
- Removing an admin signs them out immediately.
- The last owner cannot be removed; neither can you remove yourself.
- An expired or reused invite token returns 410.
- No response anywhere contains `passwordHash`.
- All four routes are in `MUTATIONS`/`READS` in `server/security.test.ts`.

## Tests to add

In `server/security.test.ts` — add the routes to the existing arrays, and:

- last-owner deletion returns 409;
- self-deletion returns 409;
- a session is invalidated after its user is deleted;
- the invite accept route rejects a tampered token.

## Out of scope

- Granular permissions (option B above).
- SSO, OAuth, or 2FA.
- An audit log of admin actions.
- Password reset for a forgotten password — related, but a separate flow with
  its own abuse considerations.
