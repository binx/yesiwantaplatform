---
task: "30"
title: Errors that say what went wrong
status: todo
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: server/routes/admin.ts:538 · server/routes/admin.ts:546 · server/uploads.ts:80 · server/routes/setup.ts · server/stripe.ts · src/admin/SetupPage.tsx:540 · src/admin/DashboardPage.tsx · src/admin/ProductEditorPage.tsx:656
completed:
shipped_in:
summary: >-
  Five paths where the merchant sees "Something went wrong" and the real reason is only in
  the server log. A reorder with a bad body is a 500; an image over the size cap is a 500; a
  50-megapixel PNG is "not a readable image"; an expired Stripe key makes Publish a 500
  while the wizard and the dashboard show a green "Stripe is connected" for that same key.
  Every fix is a mapping from an error the code already has to a message the merchant can
  act on.
---

# 30 · Errors that say what went wrong

The review ran a blank store against a `.env` whose Stripe test key had
expired. That is an ordinary thing to happen to a merchant, and Beluga's
answer was: a green check in the wizard, a green "Stripe is connected" on the
overview, and then **Publish to Stripe** failing with *Something went wrong*
for three seconds. The reason — `Expired API Key provided` — was in the API's
stdout and nowhere else. The other groups here are the same shape at smaller
scale.

`docs/tasks/README.md` already states the rule: *messages are user-facing —
say what went wrong and what to do.* This brief applies it to the places that
were missed.

## 1 · Reorder routes throw raw Zod errors

**Files:** `server/routes/admin.ts:538`, `:666`, `:714`

The three reorder routes call `reorderInputSchema.parse(req.body)` outside a
`try`, so a malformed body reaches `errorHandler` as a `ZodError` with no
status and becomes a 500. Every other route wraps its parse and hands the
error to `toHttp`, which maps `ZodError` to a 400 with the first issue. Do the
same here. Confirmed with `{"ids":"nope"}` → 500.

## 2 · Upload limits surface as 500

**Files:** `server/routes/admin.ts:546`, `:647`, `:779`, `server/uploads.ts:38`

Multer's `LIMIT_FILE_SIZE` error carries a `code` but no `status`, so the
three upload routes pass it to `next(uploadError)` and the merchant sees
*Something went wrong* for a 22 MB photo. Add a `mapUploadError` in
`server/uploads.ts` — `LIMIT_FILE_SIZE` → 413 *That image is larger than 20 MB.
Export it smaller and try again.* (the figure from `env.MAX_UPLOAD_BYTES`),
anything else from multer → 400 — and call it in the three routes. There is no
test for the size cap today; `server/uploads.test.ts` gets one.

## 3 · The pixel cap says the wrong thing

**File:** `server/uploads.ts:74`, `:80`

`limitInputPixels` is what refuses a 9000 × 9000 PNG, and sharp reports it as
an error from `metadata()`, so the catch says *That file is not a readable
image.* The image was perfectly readable. Match sharp's message (`exceeds
pixel limit`) and answer *That image is over 50 megapixels. Resize it to 7000
px or smaller on its longest side.* Keep the generic message for everything
else.

## 4 · Stripe's own errors reach the merchant

**Files:** `server/routes/admin.ts:57` (`toHttp`), `server/stripe.ts`,
`src/admin/ProductEditorPage.tsx:656`

`toHttp` knows `StripeNotConfiguredError` and nothing else from Stripe, so a
`StripeAuthenticationError` on publish or refund is a 500. Map the SDK's error
classes:

| Stripe error | Status | Message |
| --- | --- | --- |
| `StripeAuthenticationError` | 502 | Stripe rejected the secret key — it has expired or been revoked. Replace `STRIPE_SECRET_KEY` and restart the API. |
| `StripeConnectionError`, `StripeAPIError` | 502 | Stripe did not answer. Try again in a minute. |
| `StripeInvalidRequestError` | 422 | Stripe's own `message`, which names the parameter. |
| `StripeRateLimitError` | 429 | Stripe is rate-limiting this account. Try again shortly. |

Put the classification in `server/stripe.ts` next to `requireStripe`, so the
refund route and the webhook handler can use the same one. On the client, the
publish mutation shows `error.message` as a three-second toast; a failure this
consequential should be an `Alert` under the editor's header that stays until
the next attempt, the way *Not saved yet* does.

## 5 · "Stripe is connected" checks the key exists, not that it works

**Files:** `server/routes/setup.ts:91`, `server/routes/admin.ts:194`
(`/environment`), `src/admin/SetupPage.tsx:540`, `src/admin/DashboardPage.tsx`,
`scripts/setup.ts:220`

`hasStripeSecret` is `Boolean(env.STRIPE_SECRET_KEY)`. The wizard renders that
as a green *A Stripe secret key is configured on the server*, and the
overview's checklist as *Stripe is connected — done*. `npm run setup` already
knows better: it calls `balance.retrieve` — the cheapest authenticated call —
and says plainly whether the key works and whether it is live.

Do the same once, at boot, in `server/stripe.ts`: probe the key, cache
`{ ok, livemode, message }`, and expose it as `stripeKeyStatus:
"valid" | "invalid" | "unchecked"` on both `/api/setup` and
`/api/admin/environment`. `"unchecked"` covers no key and a probe that could
not reach Stripe; do not block boot on it. The wizard's Payments step and the
overview then say *The Stripe key on the server was rejected — replace it and
restart the API* with a red icon, instead of green. One call per process
start; there is no reason to re-probe per request.

## Out of scope

- Retrying Stripe calls. Publish is idempotent per product and the merchant
  can click again once they can read why it failed.
- A "test the Stripe key" button. The boot probe plus the messages above cover
  the case; a button is task-sized on its own.

## Definition of done

Per `docs/tasks/README.md`, plus:

- `server/security.test.ts` and `server/uploads.test.ts` cover groups 1–3 with
  the exact status codes.
- A test in `server/checkout.test.ts` or a new `server/stripe.test.ts` feeds a
  constructed `StripeAuthenticationError` through `toHttp` and sees the 502.
- `GET /api/setup` and `/api/admin/environment` carry `stripeKeyStatus`, and
  `server/setup.test.ts` asserts the field for a stubbed probe.
- No route added: `MUTATIONS` / `READS` unchanged.
