---
task: "29"
title: Backend hardening from the blank-store review
status: in-progress
tier: 0
size: S
migration: none
blocked_by: []
blocks: []
touches: server/routes/account.ts:101 · server/routes/session.ts:138 · server/fonts.ts:131 · server/webhooks.ts:143 · server/middleware.ts:90 · server/middleware.ts:130 · server/security.test.ts
completed:
shipped_in:
summary: >-
  Four findings from a review that probed the API with curl and read every route. None is
  exploitable today on a default deploy, and each is a defence the codebase already claims
  to have but does not quite. Account emails are awaited on only one branch, so timing
  reveals which addresses have accounts once SMTP is on; the font stylesheet fetch has no
  private-address guard; the `upgrade-insecure-requests` conditional is dead code; and one
  login limiter serves both the admin and every customer.
---

# 29 · Backend hardening from the blank-store review

Found by a review that read `server/` end to end and then probed a running
store with curl (CSRF, auth boundaries, traversal, body limits, URL
validation, SSRF guards, rate limits). Everything probed held. What follows is
what reading turned up that a probe cannot: places where the README's stated
posture and the code disagree by a few lines.

Independent groups. Land them in any order; each has its own test.

## 1 · Account emails leave the request path

**Files:** `server/routes/account.ts:101`, `server/routes/account.ts:292`,
`server/routes/session.ts:138`

Registration and both forgot-password routes are careful to answer 204 either
way, and the miss branch runs a decoy argon2 verify so the *hashing* costs
match. Then the hit branch does `await sendAccountEmail(...)`. With SMTP
configured that is a network round trip of hundreds of milliseconds that the
miss branch never pays, so a stopwatch tells a known email from an unknown one
— the exact enumeration the identical response bodies were written to prevent.
Without SMTP the send is a synchronous `console.log`, which is why nothing in
the current test suite can see it.

`sendAccountEmail` never rejects (see `server/email.ts`, it logs and returns
`false`), so it is safe to stop waiting for it:

```ts
void sendAccountEmail("VerifyEmail", parsed.data.email, verifyUrl);
```

Do the same in all three routes. Nothing about the response depends on the
result. The token write on the hit branch remains, and is one SQLite/Postgres
write against a decoy verify on the other side — the same order of magnitude
the admin path already accepts as equal.

**Test:** in `server/customers.test.ts` and `server/admin-password-reset.test.ts`,
stub `sendAccountEmail` with a promise that does not resolve until the test
releases it, and assert the 204 arrives first. That is the property; a timing
assertion would be flaky.

## 2 · The font stylesheet fetch gets the webhook guard

**Files:** `server/fonts.ts:131`, `server/fonts.ts:150`, `server/webhooks.ts:143`

`assertDeliverableUrl` in `server/webhooks.ts` resolves a hostname and refuses
anything private or reserved, and `send` re-checks every redirect hop, for the
reason the comment there gives: a merchant-supplied URL fetched by the server
is an SSRF primitive against the host. `resolveFontOrigins` fetches a
merchant-supplied URL with `redirect: "follow"` and no such check, and reports
the upstream status code in its 422 (`answered 404`). It is admin-only in the
normal case, but `POST /api/setup` calls `verifyFontUrl` too, and that route
is unauthenticated until the store has an administrator. The only thing
keeping internal hosts off the table is that the schema insists on `https://`.

Reuse rather than reimplement:

- Export the address check from `server/webhooks.ts` as its own function (the
  resolve-and-refuse half of `assertDeliverableUrl`, without the
  `WEBHOOK_ALLOW_INSECURE_TARGETS` opt-out, which is about webhook receivers
  and should not widen fonts) and call it before the fetch.
- Fetch with `redirect: "manual"` and follow up to three hops by hand, checking
  each, the way `send` does. A Google Fonts URL does not redirect; a
  self-hosted one might, once.
- Read the body through the stream and stop at `MAX_STYLESHEET_BYTES`.
  `(await response.text()).slice(...)` reads everything first, so the cap
  bounds the cache and not the memory the comment says it bounds.

Keep the status code in the error message: it is the merchant's only clue for a
typo, and once internal hosts are refused before the request it discloses
nothing.

**Test:** `server/fonts.test.ts` gains a case where the hostname resolves to
`127.0.0.1` (stub `dns.lookup` as `server/webhook-delivery.test.ts` does) and
the save is refused with no fetch made; and one where the sheet redirects to a
private address and the second hop is refused.

## 3 · `upgrade-insecure-requests` is not conditional

**File:** `server/middleware.ts:90`

```ts
...(isProduction ? { upgradeInsecureRequests: [] } : {}),
```

reads as "production only". It is not: helmet merges its defaults into the
directives you pass, and `upgrade-insecure-requests` is one of the defaults,
so the header is identical in every environment. The review confirmed it on a
development server. Harmless behind HTTPS, and irrelevant in dev where Vite
serves the page — but a self-hosted store on plain HTTP behind nothing would
have every request upgraded to an `https://` origin that does not answer.

Decide what the header should say and make the code say it. Two honest
options:

- **Always send it, and say so.** Delete the conditional, add a comment that
  plain-HTTP deployments are unsupported, and add the same sentence to
  `.env.example` next to `API_HOST`.
- **Really make it conditional.** Helmet removes a default when the directive
  is set to `null`: `upgradeInsecureRequests: isProduction ? [] : null`.

The first is the smaller change and matches the deploy story in
`docs/site-plan.md`. Either way, `server/security.test.ts` asserts the header's
directives explicitly, so the next merge of defaults cannot drift silently.

## 4 · One limiter per sign-in surface

**File:** `server/middleware.ts:130`

`loginRateLimit` is a single instance keyed by IP, mounted on the admin login,
invite acceptance, the admin password change, the customer login, email
verification and the customer password reset. Ten wrong customer passwords
from one address therefore lock the merchant out of their own admin for
fifteen minutes, and the review saw exactly that: after the admin probe hit
429, `POST /api/account/session` answered 429 too. Behind a shared office NAT
or a campus, that is a lockout nobody can explain from the inside.

Split it into two instances with the same settings —
`adminLoginRateLimit` for the admin surfaces and `customerLoginRateLimit` for
the account ones — and mount each where the current one is. Do **not** key by
email: that hands an attacker a way to lock out a victim by name, which is
worse than the shared-IP problem.

**Test:** `server/security.test.ts` (or `customers.test.ts`) exhausts one
surface and asserts the other still answers 401 rather than 429.

## Not changed, on purpose

- Invite links are returned in the API response when SMTP is not configured.
  That is documented and is the only way a store without email can add
  staff. The response is only ever seen by an administrator.
- The decoy hash in `server/auth.ts` was timed against a real verify during
  the review and is within a millisecond. Leave it.

## Out of scope

- Per-account lockout or CAPTCHA on repeated failures.
- Restricting font URLs to an allow-list of providers. The guard above is
  enough, and the point of task 22 was that self-hosted sheets work.

## Definition of done

Per `docs/tasks/README.md`, plus the four tests named above. No route is
added, so `MUTATIONS` / `READS` are unchanged, but group 3 adds an explicit
CSP assertion to `server/security.test.ts`.
