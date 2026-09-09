---
task: "24"
title: An administrator can reset a forgotten password
status: done
tier: 0
size: S
migration: two columns on admin_users
blocked_by: []
blocks: []
touches: server/routes/session.ts · server/auth.ts · shared/api.ts · src/admin/LoginPage.tsx · emails/ResetPassword
completed: 2026-09-09
shipped_in: 20
summary: >-
  Customers have a forgot-password flow; administrators do not. A solo merchant who loses
  their password has no route back except the database. Reuse the customer flow's shape —
  hashed single-use token, one-hour expiry, identical response for known and unknown
  emails — on `admin_users`, with the same session revocation the change-password route
  already does.
---

# 24 · An administrator can reset a forgotten password

Found on the admin sign-in page: *Email*, *Password*, *Show*, *Sign in*, *Back
to the storefront*. The customer sign-in page one route over has *Forgot your
password?*; this one does not.

## The problem

`admin_users` (`db/schema.sqlite.ts:71`) holds an email and an argon2id hash.
The only way to change the hash is `POST /api/admin/password` on the Staff page
(`server/routes/admin.ts:1112`), which requires being signed in and knowing the
current password. An administrator who has neither — the common case for a
one-person shop that set Beluga up months ago — can:

- ask another administrator to invite them again, which needs another
  administrator to exist, or
- open the database and write a hash by hand.

The second is what people will actually do, and it is the kind of step the
README exists to make unnecessary. Task 11 built exactly this flow for
customers; the pieces are all there.

## What to build

### Columns

`password_reset_token_hash` and `password_reset_expires_at` on `admin_users`,
both dialects — the same two the `customers` table has
(`db/schema.sqlite.ts:126`). A hash only; the raw token exists in the emailed
link and nowhere else, per the staff-invite rule.

### Routes

Two public routes on the session router (`server/routes/session.ts`), outside
`requireAdmin` because the caller by definition cannot sign in, and behind
`emailRateLimit` (`server/middleware.ts:78`) — the limiter that counts every
response, since this route must answer 204 whether or not the email exists:

- `POST /api/session/forgot-password` `{ email }` → 204 always. When the email
  belongs to an administrator, mint a token, store its hash with a one-hour
  expiry, and send the `ResetPassword` email to that address with
  `/admin/reset-password?token=…` built from `PUBLIC_URL`. Do the argon2
  decoy work on the miss branch the way `createCustomer` does, so the two
  branches cost the same and not merely look the same.
- `POST /api/session/reset-password` `{ token, password }` → 204. Look up by
  the token's hash, refuse if expired or absent, write the new hash, clear
  both columns, and **destroy every session for that administrator** — the
  behaviour `POST /api/admin/password` already has, and the point of a reset:
  whoever had the old password is signed out.

Both go in `READS`/`MUTATIONS` in `server/security.test.ts` as public routes,
so the test asserts they are reachable signed out and still CSRF-checked.

When `SMTP_URL` is not configured the customer flow logs the link instead of
sending it; do the same here, and say on the page: *If this store has no email
provider, the link is in the API's log.* That is the self-hosted case, and it
is the case most likely to need this feature.

### Pages

Two routes under `/admin` in `src/router.tsx`, lazy like the rest, rendered
without `RequireAdmin`: `forgot-password` and `reset-password`. The customer
pages `ForgotPasswordPage.tsx` and `ResetPasswordPage.tsx` are the template;
the copy changes, the shape does not. Add the *Forgot your password?* link to
`LoginPage.tsx` under the form, styled as a link (task 17 group 4).

## Out of scope

- Password rules beyond the existing twelve-character minimum.
- Two-factor authentication. Worth a brief of its own once a real store runs on
  this.
- Recovering an account whose email is no longer readable. That is what
  staff invitations are for.

## Definition of done

Per `docs/tasks/README.md`, plus:

- Both dialects, both migration folders.
- Server tests: a known and an unknown email both answer 204 and the timing
  does not distinguish them by branch; an expired token is refused; a used token
  is refused; a reset destroys other sessions and leaves none.
- `server/security.test.ts` lists both routes.
- The README **Staff accounts** section says administrators can reset a
  forgotten password by email.
