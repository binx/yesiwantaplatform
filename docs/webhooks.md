# Using Beluga's outbound webhooks

A guide to building something that receives them. If you want the design
rationale instead, see [`docs/tasks/14-outbound-webhooks.md`](tasks/14-outbound-webhooks.md).

Beluga POSTs a signed JSON body to a URL you own whenever something happens in
the store. That is the whole integration surface: there is no SDK to install, no
app to register, and nothing of yours runs inside Beluga's process. If you can
serve an HTTPS endpoint, you can wire the store to your fulfilment provider,
your ledger, a Slack channel, or a Zapier-style connector.

---

## 1. Add an endpoint

**Admin → Webhooks → Add an endpoint.** Give it a URL, tick the events you care
about, and save.

You will be shown a **signing secret** exactly once, on that screen. Copy it
somewhere your receiver can read it — an environment variable, not your source
tree. Nothing reads it back afterwards; if you lose it, use **Roll secret** to
mint a new one and update your receiver, remembering that the old secret stops
working the moment you roll.

Two rules on the URL, and neither is negotiable in a normal deployment:

- It must be `https://`.
- Its hostname must resolve to a **public** address. `localhost`, `10.x`,
  `192.168.x`, `172.16–31.x` and `169.254.169.254` are all refused, and so is a
  hostname that resolves to one of them.

That second rule is why an admin cannot use this feature to read the server's
cloud metadata. See [Testing locally](#6-testing-locally) for the supported way
around it while you are developing.

---

## 2. The events

| Event | Fires when | The `data` object |
| --- | --- | --- |
| `order.paid` | Stripe confirmed payment | Order |
| `order.updated` | Fulfilment status, carrier or tracking number changed | Order |
| `order.refunded` | A refund settled | Order |
| `order.cancelled` | An order was cancelled from the admin | Order |
| `product.published` | A product was published to Stripe | Product |
| `inventory.low` | A sale left a finite variant at 5 units or fewer | Variant |

A few things worth knowing before you pick:

- **`order.paid` is the one most integrations want.** It fires from the Stripe
  webhook — the only thing in Beluga that marks an order paid — so it means the
  money is genuinely confirmed, not that a buyer reached a success page.
- **`order.refunded` covers partial refunds too.** Compare `refundedCents` with
  `totalCents` to tell them apart; equal means fully refunded.
- **`order.updated` does not fire for the cancellation.** A cancel sends
  `order.cancelled` instead, so you do not have to diff statuses to spot one.
- **`inventory.low` fires per variant, once per qualifying sale.** It is not a
  latched alert: a variant sitting at 2 units will fire again on the next sale
  that touches it. Threshold is 5 and is not configurable — filter on
  `remaining` if you want a different number.

---

## 3. The request

```http
POST /your/endpoint HTTP/1.1
content-type: application/json
user-agent: Beluga-Webhooks/1
beluga-event-id: evt_9a3f1c02-5d7e-4b18-9f2a-7c1e6b40d833
beluga-signature: t=1757336400,v1=6f2a…
```

Every body is the same envelope:

```json
{
  "id": "evt_9a3f1c02-5d7e-4b18-9f2a-7c1e6b40d833",
  "type": "order.paid",
  "created": 1757336400,
  "data": { }
}
```

`id` matches the `beluga-event-id` header, so you can deduplicate without
parsing the body. `created` is unix **seconds**.

### `order.paid`, `order.updated`, `order.refunded`, `order.cancelled`

```json
{
  "id": "evt_9a3f1c02-5d7e-4b18-9f2a-7c1e6b40d833",
  "type": "order.paid",
  "created": 1757336400,
  "data": {
    "id": "5f8c1e2a-9d43-4c7b-8a15-2e6f0b93d471",
    "reference": "5F8C1E2A",
    "email": "buyer@example.com",
    "status": "paid",
    "currency": "USD",
    "subtotalCents": 3400,
    "shippingCents": 600,
    "taxCents": 280,
    "discountCents": 0,
    "totalCents": 4280,
    "refundedCents": 0,
    "carrier": null,
    "trackingNumber": null,
    "oversold": false,
    "createdAt": 1757336388000,
    "shipping": {
      "name": "A Buyer",
      "line1": "1 Test Street",
      "line2": null,
      "city": "Marfa",
      "state": "TX",
      "postalCode": "79843",
      "country": "US"
    },
    "items": [
      {
        "productId": "demo-tote",
        "variantId": "demo-tote-s",
        "productName": "Canvas Tote",
        "variantLabel": "Small",
        "unitPriceCents": 3400,
        "quantity": 1,
        "options": { "monogram": "AB" }
      }
    ]
  }
}
```

**Every money field is an integer number of cents** and is named `*Cents` to say
so. There are no floats anywhere in this payload, and there should not be any in
your handler either — `4280` is $42.80.

`createdAt` is unix **milliseconds** (it is the order's timestamp), while the
envelope's `created` is unix **seconds** (it is the event's). They are different
units on purpose; do not mix them up.

`reference` is the short, human-quotable form of `id` — its first eight hex
digits, uppercased — and is what a customer sees on their confirmation email. It
is the field to quote back at a buyer; `id` is the one to key your records on.

`productId` and `variantId` are nullable: the catalogue can change after a sale,
and an order must still render as it was bought. `productName`, `variantLabel`
and `unitPriceCents` are snapshots taken at purchase and are always present.

### `product.published`

```json
{
  "id": "evt_1c4b…",
  "type": "product.published",
  "created": 1757336500,
  "data": {
    "id": "demo-tote",
    "slug": "canvas-tote",
    "name": "Canvas Tote",
    "isLive": true,
    "stripeProductId": "prod_QxYz123",
    "variants": [
      { "id": "demo-tote-s", "label": "Small", "priceCents": 3400 },
      { "id": "demo-tote-l", "label": "Large", "priceCents": 3900 }
    ]
  }
}
```

### `inventory.low`

```json
{
  "id": "evt_7e91…",
  "type": "inventory.low",
  "created": 1757336400,
  "data": {
    "productId": "demo-tote",
    "productName": "Canvas Tote",
    "variantId": "demo-tote-s",
    "variantLabel": "Small",
    "remaining": 3,
    "threshold": 5
  }
}
```

### What is never in a payload

No Stripe keys, no payment intent id, no session data, no password hashes, no
customer record. Payloads are built field by field rather than spread from a
database row, and there is a test asserting the serialised body contains none of
those things. If you need something that is not here, fetch it through the admin
API with your own credentials.

### Truncation

Bodies are capped at 64 KB. A very large order exceeds that, and when it does
the `items` array is emptied and a top-level `"truncated": true` is added. Every
identifier is still present, so treat it as a signal to go and fetch the order
rather than as data loss:

```js
if (event.truncated) {
  const order = await fetchOrderFromBelugaAdminApi(event.data.id);
}
```

---

## 4. Verify the signature

**Do this before you trust anything in the body.** An unverified endpoint is a
URL anyone on the internet can POST fake orders to.

The `beluga-signature` header is `t=<unix seconds>,v1=<hex>`, where the hex is
an HMAC-SHA256 of `` `${t}.${rawBody}` `` under that endpoint's secret. This is
deliberately the same shape Stripe uses, so if you already verify Stripe's
webhooks, this is that code with a different header name.

### Node / Express

```js
import crypto from "node:crypto";
import express from "express";

const app = express();
const SECRET = process.env.BELUGA_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 5 * 60;

// `express.raw`, NOT `express.json` — see the gotcha below.
app.post("/hooks/beluga", express.raw({ type: "application/json" }), (req, res) => {
  const header = req.get("beluga-signature") ?? "";
  const [tPart, vPart] = header.split(",");
  const timestamp = tPart?.slice(2);
  const provided = vPart?.slice(3);

  if (!timestamp || !provided) return res.status(400).end();

  // Reject anything too old to be a live delivery. The timestamp is inside the
  // signed material, so an attacker cannot re-stamp a body they captured.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) {
    return res.status(400).end();
  }

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${timestamp}.${req.body}`)
    .digest("hex");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).end();
  }

  const event = JSON.parse(req.body.toString("utf8"));

  // Answer first, work afterwards — see §5.
  res.json({ received: true });
  void handle(event);
});
```

> **The gotcha that catches everyone.** You must HMAC the *raw bytes*. If a body
> parser has already turned the request into an object, re-serialising it will
> not reproduce them — key order and whitespace differ — and every signature will
> fail. In Express that means `express.raw({ type: "application/json" })` on this
> route, mounted *before* any global `express.json()`. Beluga's own Stripe
> consumer has the same constraint, for the same reason.

### Python / Flask

```python
import hashlib, hmac, os, time
from flask import Flask, request

app = Flask(__name__)
SECRET = os.environ["BELUGA_WEBHOOK_SECRET"].encode()
TOLERANCE_SECONDS = 5 * 60

@app.post("/hooks/beluga")
def beluga():
    header = request.headers.get("Beluga-Signature", "")
    try:
        t_part, v_part = header.split(",")
        timestamp, provided = t_part[2:], v_part[3:]
    except ValueError:
        return "", 400

    if abs(time.time() - int(timestamp)) > TOLERANCE_SECONDS:
        return "", 400

    # request.get_data() is the raw body; request.json is not.
    expected = hmac.new(
        SECRET, f"{timestamp}.".encode() + request.get_data(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(provided, expected):
        return "", 400

    handle(request.get_json())
    return {"received": True}
```

---

## 5. Delivery semantics

### Answer fast, then do the work

Beluga waits **10 seconds** for a response, then treats the delivery as failed.
Any `2xx` means accepted; anything else — or a timeout, or a connection error —
gets the retry schedule. Answer immediately and hand the event to a queue or a
background job; don't ship a parcel while Beluga is holding the socket open.

Redirects are followed, up to 3 hops, and each hop is re-checked against the
address rules from §1. Prefer to just give the final URL.

### At-least-once, so make your handler idempotent

You **will** occasionally see the same event twice — a response that got lost on
the way back looks identical to one that never arrived. Deduplicate on the event
id, which is stable across every retry of the same event:

```js
async function handle(event) {
  if (await alreadyProcessed(event.id)) return;
  await doTheWork(event);
  await recordProcessed(event.id);
}
```

Two subscribers to the same event receive the **same** `id`, so if you run two
receivers, key your dedup store per receiver rather than sharing one.

Ordering is not guaranteed either. If it matters — say, an `order.updated`
arriving before the `order.paid` it follows — reconcile on the order's own
`status` rather than on arrival order.

### Retries and backoff

A failed delivery is retried five times, with the gap growing each time:

| Attempt | Sent after |
| --- | --- |
| 1 | immediately (within ~10s of the event) |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 25 minutes |
| 5 | 2 hours |
| 6 | 10 hours |

After the sixth, that delivery gives up and is marked **Gave up** in the admin.
The event is not lost — you can replay it with **Redeliver**.

### Endpoints that stay broken get switched off

Five deliveries in a row that give up, and Beluga disables the endpoint rather
than retrying forever. The admin shows it as *Disabled after failures*, with the
last error. Fix your receiver, then flip it back on — re-enabling clears the
failure count, and anything still queued goes out rather than being discarded.

Any successful delivery resets the count to zero, so an occasional blip never
accumulates towards the cap.

---

## 6. Testing locally

Your development machine is not publicly reachable, which the address rules in
§1 will correctly refuse. Two ways forward:

**A tunnel (recommended).** Point a tunnel at your local receiver and register
its public HTTPS URL:

```bash
ngrok http 3000
```

This exercises the real path — real DNS, real TLS, real signatures — and needs
no configuration change in Beluga.

**The opt-out.** For a self-hosted store whose receiver genuinely lives on
localhost, set:

```bash
WEBHOOK_ALLOW_INSECURE_TARGETS=true
```

This lifts both restrictions: plain `http://` and private addresses are then
allowed. It is off by default and should stay off anywhere public — with it on,
anyone with admin access can point an endpoint at your cloud metadata service
and read the results out of the delivery log.

**Triggering a real event.** Complete a test payment with Stripe's test card
(`4242 4242 4242 4242`, any future expiry, any CVC). That produces a genuine
`checkout.session.completed`, which is what emits `order.paid`. Marking the
order shipped in the admin then gives you an `order.updated`.

**Replaying.** Every endpoint's row in the admin expands into its recent
deliveries — event type, attempt count, response status, and the error if there
was one. **Redeliver** puts a single delivery back at the front of the queue with
its attempt count reset, which is the fastest loop while you are debugging a
handler.

---

## 7. Troubleshooting

| Symptom | Almost always |
| --- | --- |
| Every signature fails | You hashed a re-serialised body. HMAC the raw bytes — see the gotcha in §4. |
| Signatures failed suddenly, after working | Someone rolled the secret. Update your receiver. |
| Deliveries show *no response* | Your endpoint took longer than 10s, or the connection failed. Answer first, work after. |
| Endpoint rejected on save | The hostname resolves to a private address, or the URL is not `https://`. |
| Nothing arrives at all | Check the endpoint is enabled and subscribed to that event type — both are on its row in the admin. |
| The same order processed twice | Your handler is not idempotent. Deduplicate on the event id. |
| Totals are 100× too big | You read `*Cents` as a currency amount. `4280` is $42.80. |
| `items` is empty on a large order | The body hit the 64 KB cap; check for `"truncated": true` and fetch the order. |

---

## 8. What this is not

- **There is no write API.** Webhooks tell you what happened; they are not a way
  to push changes back into the store. Use the admin API with your own session
  for that.
- **There is no app install flow**, no OAuth, and no per-app scopes. An endpoint
  is created by a store administrator, in that store's admin, and sees the events
  they ticked.
- **Delivery is not ordered or exactly-once.** See §5.
