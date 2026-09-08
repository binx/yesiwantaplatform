---
task: "14"
title: Outbound webhooks
status: done
tier: 3
size: M
migration: two tables
blocked_by: []
blocks: []
touches: server/webhooks.ts · db/webhooks-repository.ts · server/routes/webhook.ts
completed: 2026-09-08
shipped_in: 2
summary: >-
  The substitute for an app ecosystem. Emitting `order.paid` and `order.shipped` to a
  merchant's own endpoint buys most of the integration surface for a fraction of the cost
  — and Beluga already has a correct at-least-once consumer in `server/routes/webhook.ts`
  to model the producer on. Refuse private address ranges at endpoint creation, or this
  becomes an SSRF primitive against the host.
---

# 14 · Outbound webhooks

## Why this instead of an app ecosystem

Shopify's app store is the thing an open-source project cannot replicate — it
needs a marketplace, a review process, a billing relationship and an SDK with a
versioning commitment. Outbound webhooks buy most of the *integration* value for
a fraction of that: a merchant can wire Beluga to their fulfilment provider,
their accounting, or a Zapier-style connector without either side shipping code
into the other's process.

There is a good model to copy in-repo. `server/routes/webhook.ts` is a correct
at-least-once **consumer** — signature verification, dedup by event id, release
on failure so retries are processed. Build the producer to the same standard, and
read that file before starting.

## What to build

- An `endpoints` table: url, a generated signing secret, subscribed event types,
  enabled flag, consecutive failure count.
- A `deliveries` table: endpoint, event type, payload, attempt count, next
  attempt time, response status, delivered/failed timestamps.
- Events to emit, matching the states the system already knows about:
  `order.paid`, `order.updated`, `order.refunded`, `order.cancelled`,
  `product.published`, `inventory.low`.
- **Sign every request** — HMAC-SHA256 over timestamp and body, in a header,
  exactly the shape Stripe uses, so a merchant already verifying Stripe
  signatures can reuse their code. Include the timestamp in the signed payload to
  make replay detectable.
- **Retry with exponential backoff** and a cap — the same delivery guarantee
  Beluga asks of Stripe. Disable an endpoint after a run of consecutive failures
  and surface that in the admin rather than retrying forever.
- Deliver **out of band**. Never in the Stripe webhook's request path: a slow
  merchant endpoint must not delay the response to Stripe, which would trigger
  Stripe's own retry and re-enter the handler. Enqueue and return.

The scheduler question is the same one [12](12-abandoned-cart.md) faces. If both
are on the roadmap, whichever lands first should build the lease-guarded interval
and the other should reuse it. Say so in the PR.

## Security

- **Refuse private address ranges by default.** An endpoint URL pointing at
  `127.0.0.1`, `169.254.169.254`, or an RFC1918 address turns this into an SSRF
  primitive against the host — cloud metadata endpoints being the obvious target.
  Resolve the hostname and check the resolved IP, not just the string, and
  re-check on redirect. Allow an explicit opt-out env var for self-hosters who
  genuinely want a loopback target.
- HTTPS only, except for that opt-out.
- Show the signing secret **once** on creation and never again; store a hash.
- Cap payload size and never include the Stripe secret key, session data, or a
  password hash. Write a test asserting the serialised payload contains none of
  them.

## Acceptance

- A subscribed endpoint receives a signed `order.paid` after a test payment.
- The signature verifies with a documented snippet the README provides.
- A failing endpoint is retried with backoff and disabled after the cap.
- An endpoint pointed at `169.254.169.254` is rejected at creation.
- Stripe webhook response time is unaffected by a slow subscriber.

## Out of scope

- A REST write API for third parties. Read-your-own-data first, if at all.
- OAuth, app installation flows, or per-app scopes.
- A retry UI beyond "redeliver this one".
