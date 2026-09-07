# Shipping: design notes

Shipping has always been the weak point in Beluga. v1 modelled it as a magic
Stripe SKU the browser picked, which meant one flat price, no address
awareness, no international support, and no labels. This is the plan for
replacing it.

## The constraint, checked against the pinned SDK

The worry with hosted Stripe Checkout is that shipping options must exist
*before* the session does — i.e. before the buyer's address is known. An
earlier draft of this note recorded that as solved: create the session with
`permissions.update_shipping_details: "server_only"` and keep the hosted page.

**That is wrong, and it matters.** From `stripe@22.6.1`, the version this repo
pins (`node_modules/stripe/esm/resources/Checkout/Sessions.d.ts:490`):

```ts
interface Permissions {
  /**
   * Determines which entity is allowed to update the shipping details.
   * Default is `client_only`. … If set to `server_only`, only your server
   * is allowed to update the shipping details.
   *
   * This parameter is only supported when `ui_mode=elements`.
   */
  update_shipping_details?: Permissions.UpdateShippingDetails;
}
```

`ui_mode` in this version is `'elements' | 'embedded_page' | 'form' |
'hosted_page'`, and **defaults to `hosted_page`** — which is what
`server/routes/checkout.ts` uses today, by omission.

Two corrections follow:

1. **Dynamic shipping is not available on the hosted redirect.** Getting live
   carrier rates means `ui_mode: 'elements'`: Beluga hosts the checkout page,
   mounts Stripe Elements, and collects the address itself. The hosted page
   goes away. That reverses the Phase 0 payments decision, which chose hosted
   Checkout specifically to delete the custom checkout and its bug cluster.

2. **Stripe does not call us.** The mechanism is not a callback. Our own page
   collects the address, sends it to our server, and the server calls
   `checkout.sessions.update` with recalculated `shipping_options` —
   `SessionUpdateParams` accepts both `shipping_options` and
   `collected_information.shipping_details` (`Sessions.d.ts:4790`, `:4797`).
   `server_only` exists to stop the *client* changing the address behind us,
   which is a price-integrity control. It is the same rule as the rest of this
   codebase: money is never taken from the request.

So the architectural tension is real after all. Live rates cost us the hosted
page, not merely the express wallet buttons.

### What the trade actually is

| | Hosted (today) | `ui_mode: 'elements'` |
| --- | --- | --- |
| Who renders checkout | Stripe | Beluga |
| Live carrier rates | ✗ | ✓ |
| Address collection | Stripe | Beluga (we own validation anyway) |
| Wallets | Automatic on Stripe's page | Payment Element shows Apple/Google Pay as methods; the one-tap **Express Checkout Element** is incompatible with dynamic shipping |
| Checkout UI to maintain | None | Ours, forever |
| PCI scope | SAQ-A | Card fields stay in Stripe iframes, so still commonly SAQ-A — **confirm with your acquirer before relying on it** |

The wallet point is narrower than it first looks: moving to Elements does not
remove Apple Pay and Google Pay, it removes the *express buttons at the top of
the page*. Worth confirming against current Stripe docs before deciding.

This is why the tiering below is not a nicety. Tiers 1 and 2 keep the hosted
page; tier 3 is a checkout rewrite wearing a shipping hat.

## Recommended shape

Three tiers, chosen per store, because a five-product art shop and a
500-SKU apparel store want different things:

| Tier | What it does | Who it's for |
| --- | --- | --- |
| **Flat rates** (default) | Named rates with fixed prices, optionally per-zone | Most small stores. No third-party account, no per-label cost. |
| **Weight-based tables** | Rates from cart weight × destination zone | Stores with heavy or variable goods, still no carrier account. |
| **Live carrier rates** | Real quotes from USPS/UPS/FedEx at checkout | High-volume, margin-sensitive, or international. |

Only the third tier needs an external provider, and it should stay opt-in.
Defaulting everyone into a carrier integration would undo the "clone it and it
runs" property we just spent two phases building.

## Provider recommendation: Shippo, with EasyPost as the alternative

Both are aggregators — one API across USPS, UPS, FedEx, DHL — which is what we
want; integrating carriers directly means three separate certifications, three
credential formats, and USPS's own API migration churn.

**[Shippo](https://goshippo.com)** is the better default for Beluga's users:
rate shopping, labels, tracking, address validation and returns work out of the
box rather than needing assembly, the free tier is generous, and merchants
without their own carrier contracts still get discounted rates. The trade is a
small markup on those rates.

**[EasyPost](https://www.easypost.com)** is the better choice for anyone with
existing carrier contracts (bring-your-own-account, no markup) or who wants
more control. It gives you building blocks rather than a platform.

Both charge per label and per address validation. Neither should be a hard
dependency.

For **international duties and taxes quoted at checkout**, neither handles it
natively — that is [Easyship](https://www.easyship.com)'s speciality, along
with HS-code classification. Worth a look only if a store actually needs
landed-cost quoting; otherwise ship DDU and say so at checkout.

## Proposed implementation

### 1. Shipping profiles (no provider needed)

Extend `shipping_rates` with zones and weight bands:

```
shipping_zones        id, name, country_codes[], position
shipping_rates        + zone_id, min_weight_g, max_weight_g,
                        min_subtotal_cents, max_subtotal_cents
```

`min_subtotal_cents` gives free shipping over a threshold, which is the single
most requested rule and needs no carrier at all.

Products need `weight_g` and optional `length/width/height_mm` on the variant —
required for any live rate, and useful for weight bands regardless.

### 2. Address validation

Do this **before** creating the session, on our own cart page, not at Stripe.
A normalised, deliverable address prevents the most common support burden.
Shippo and EasyPost both expose validation; USPS's own API covers US-only and
is free.

Treat a validation failure as a warning, never a hard block — buyers do
legitimately live at addresses the databases disagree about.

### 3. Live rates — only alongside a move to `ui_mode: 'elements'`

There is no hook to implement. The sequence is ours end to end:

```
our checkout page (Elements)
  → buyer enters address
  → POST /api/checkout/:id/shipping   (our route, our session)
      → sum parcel weight and dimensions from our variants
      → ask the provider for rates
      → cache by (address hash, parcel signature) for a few minutes
      → checkout.sessions.update({ shipping_options, collected_information })
  → Elements re-renders the options
```

Rules worth holding to:

- **Never let the provider's failure block a sale.** On timeout or error, fall
  back to the store's flat rates. A checkout that dies because a carrier API is
  slow is worse than a slightly wrong shipping price.
- **Recompute server-side on submit.** The rate the buyer picked is an id, not
  a price; resolve it again before payment, exactly as line items already are.
- **Cap the option count.** Buyers presented with eleven services choose none.
- **Cache aggressively.** Rate calls cost money and are slow.

Because this tier drags the whole checkout with it, it should be scoped and
approved as its own phase, not folded into a shipping ticket.

### 4. Labels and tracking

After fulfilment, buy the label from the same provider and write the tracking
number back onto the order — the field already exists, and the "Shipped" email
already renders it. This replaces manual tracking entry with one click, and is
where the provider pays for itself.

### 5. International

- Expand `shipping_address_collection.allowed_countries` beyond the current
  six; it is currently a hard-coded list in `server/routes/checkout.ts`.
- Store country-specific zones so a US store can offer domestic and
  international bands without carrier integration.
- Customs declarations (contents, value, HS code) become required per product
  once international labels are bought. Add `hs_code` and `country_of_origin`
  to products at that point, not before.
- Be explicit in the UI about DDU: the buyer may owe duties on delivery.

## Sequencing

**Tiers 1 and 2 have shipped.** Zones, weight bands, subtotal bands (including
free-over-threshold), per-variant weights, an admin table with a coverage
warning, and a destination picker on the cart. Resolution is one pure function
in `shared/shipping.ts`, called by both the cart quote and the checkout route so
the two cannot disagree. The hosted checkout is unchanged.

Tier 3 remains as described below.

Tier 3 is not an increment on them. It requires `ui_mode: 'elements'`, which
means Beluga owns the checkout page again — the thing Phase 0 deliberately gave
away. Treat it as a payments phase with a shipping payload, behind a
`ShippingProvider` interface so Shippo and EasyPost stay interchangeable and
neither is ever required to run Beluga.

A reasonable middle, if live rates are wanted before that appetite exists:
quote rates on **our cart page** (where we already intend to validate the
address), then pass the chosen quote to the hosted session as a one-off
`shipping_options` entry. The buyer cannot change address at Stripe without
invalidating the quote, so pair it with
`shipping_address_collection` omitted and the address treated as final. It is
less forgiving than the Elements flow, but it needs no checkout rewrite.

Sources: verified against `stripe@22.6.1` type definitions in this repo;
[Stripe dynamic shipping](https://docs.stripe.com/payments/advanced/shipping),
[Stripe shipping rates API](https://docs.stripe.com/api/shipping_rates),
[EasyPost vs Shippo vs ShipStation](https://www.easypost.com/easypost-vs-shippo-vs-shipstation/).
