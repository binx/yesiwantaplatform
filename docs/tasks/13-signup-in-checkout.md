---
task: "13"
title: Sign up without leaving the checkout
status: done
tier: 1
size: M
migration: none
blocked_by: []
blocks: []
touches: src/pages/account/AccountRegisterPage.tsx:32 · src/pages/account/VerifyEmailPage.tsx:28 · server/routes/account.ts:147 · src/pages/CartPage.tsx:202 · src/components/postcard/Recipients.tsx:190 · emails/
completed: 2026-09-10
shipped_in: 22
summary: >-
  A shopper who taps "Sign in to keep your recipients" from the cart and creates an
  account lands on "Check your email" with one button, "Back to sign in", and no way
  back to their cart. Registering does not sign them in (by design: the register
  response must not reveal whether the email was taken). Keep that guarantee and stop
  losing the sale: remember where they came from, let them carry on as a guest, and
  bring the verification link back to the same place.
---

# 13 · Sign up without leaving the checkout

Found in the 2026-09-10 new-customer walkthrough. Effort: half a day.

## The problem

`POST /api/account/register` (`server/routes/account.ts:147`) answers 204
whether or not the email was already taken, and deliberately does not sign
the new customer in — a session on the "taken" branch would sign one person
into another's account, and none on that branch alone would tell an
attacker the address exists. That reasoning is right and stays.

The cost is where the page goes afterwards. `AccountRegisterPage.tsx:32`
replaces the form with "Check your email" and a **Back to sign in** button.
The cart's link (`CartPage.tsx:202`) and the designer's
(`Recipients.tsx:190`) pass `state.from`, and the login page honours it, but
the register page — one click away via "New here? Create an account" —
drops it. A shopper mid-checkout leaves the site to find an email, and
whether they come back is up to their inbox.

Two facts make the fix cheap: checkout works signed out, and
`claimOrdersForCustomer` (`account.ts:189`) attaches past orders to the
account at verification time. So a guest who buys now and verifies later
loses nothing; the page just needs to say so and keep the door open.

## What to build

### 1. Carry `from` through register and verify

- `AccountRegisterPage`: read `location.state.from` exactly as
  `AccountLoginPage` does (same `LocationState`, same `startsWith("/")`
  guard), and pass it on the "Sign in" link at the bottom. `AccountLoginPage`
  passes it on its "Create an account" link the same way.
- `useRegister` sends `next: from` in the body (`customerRegisterInputSchema`
  in `shared/account.ts` gains an optional `next` string, same-site path
  only, validated server-side with the same guard).
- The register route puts `next` on the verification link:
  `/account/verify?token=…&next=/cart`. Only when the email was actually
  new — the taken branch sends nothing, as today. The token table does not
  change; `next` rides in the URL only.
- `VerifyEmailPage`: after `verify.mutate` succeeds, navigate to `next`
  if it is a same-site path, else `/account`.

The `VerifyEmail` template in `emails/` already takes the URL; no copy
change is needed there beyond checking it does not say "then sign in".

### 2. Do not dead-end

Replace the success `Result` in `AccountRegisterPage` with:

- Title **Check your email**.
- Text: **"We've sent a link to verify your email. You don't have to wait
  for it — carry on with your order and it will show up in your account once
  you've clicked the link."** (This is brief 12's wording, extended.)
- Primary button: when `from` is `/cart`, **Back to your cart**; when it is
  `/create`, **Back to your postcards**; otherwise **Continue shopping** to
  `/`. Secondary: **Sign in** to `/account/login` with the same `from`.

### 3. Say it before they leave, too

The two "Sign in …" prompts already exist; add what happens if they do
not:

- Cart (`CartPage.tsx:202`): **"Sign in to keep your recipients for next
  time and follow your orders. No account? Check out as a guest — your
  order is attached to any account you make with the same email later."**
- The same sentence is not needed in the designer; its prompt is about
  saved recipients only.

### 4. Confirmation page

`ConfirmPage` (`src/pages/ConfirmPage.tsx`) is the last thing a guest sees.
If they are signed out, add one line under the schedule: **"Make an account
with {email} to follow these cards and reuse the addresses next time."**
linking to `/account/register` with `state.from = "/confirm?…"` (the
current `location.pathname + location.search`), so verification returns
them to the order. Skip it when `useCustomer` has a session.

## Acceptance

- From the cart: Sign in → Create an account → submit → "Check your email"
  with **Back to your cart**; clicking it shows the cart with its line
  intact (the cart is local state in `src/store/cart.ts`, so this is a
  routing check, not a persistence one).
- Open the verification link from the API log (`[email] SMTP is not
  configured; the VerifyEmail link …`) in the same browser: the page lands
  on `/cart`, signed in, and the cart's "Sign in" prompt has gone.
- Register with an email that already has an account: identical
  "Check your email" page, identical response time within noise, no link
  sent (assert on the email stub in `server/customers.test.ts`).
- A `next` of `https://evil.example` or `//evil.example` is ignored on
  both sides.

## Tests to add

- `server/customers.test.ts`: `next` appears in the sent URL for a new
  email; is absent for a taken one; an off-site `next` is dropped.
- `shared/account.test.ts` (or wherever `customerRegisterInputSchema` is
  covered): `next` must start with a single `/`.
- A Playwright case: the flow in the first acceptance bullet, reading the
  verify link out of the API's stdout is awkward in e2e — instead stub
  `POST /api/account/register` and `POST /api/account/verify` with
  `page.route` and assert the navigation targets.

## Out of scope

- Signing in immediately on registration. It cannot be done without
  giving up the enumeration guarantee; if that trade is ever wanted it is
  a one-line change in the register route and a rewrite of its comment,
  not this brief.
- Magic-link sign-in.
