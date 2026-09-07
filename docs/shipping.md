# Shipping: design notes

Shipping has always been the weak point in Beluga. v1 modelled it as a magic
Stripe SKU the browser picked, which meant one flat price, no address
awareness, no international support, and no labels. This is the plan for
replacing it.

## The constraint that isn't

The obvious worry with hosted Stripe Checkout is that you must know the
shipping options *before* the session exists — i.e. before you know the
buyer's address. That turns out to be wrong.

Stripe supports [dynamically customizing shipping options](https://docs.stripe.com/payments/advanced/shipping):
create the session with `permissions.update_shipping_details: "server_only"`,
and Stripe calls your endpoint when the buyer enters an address. You return
recalculated `shipping_options`, and Stripe re-renders them.

So live carrier rates are compatible with the hosted checkout we already have.
Two caveats worth recording:

- **Payment mode only.** Not available for subscriptions — irrelevant here.
- **Not compatible with the Express Checkout Element** (Apple Pay / Google Pay
  express buttons). Enabling dynamic shipping costs us the one-tap wallet
  flow. That is a genuine trade, and the reason the recommendation below keeps
  flat rates as the default.

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

### 3. Live rates via the Stripe hook

```
POST /api/checkout/shipping   (called by Stripe, server_only)
  → read the session's line items and the submitted address
  → sum parcel weight and dimensions from our variants
  → ask the provider for rates
  → cache by (address hash, parcel signature) for a few minutes
  → return 3-4 named options, marked up per the store's settings
```

Rules worth holding to:

- **Never let the provider's failure block a sale.** On timeout or error, fall
  back to the store's flat rates. A checkout that dies because a carrier API
  is slow is worse than a slightly wrong shipping price.
- **Cap the option count.** Buyers presented with eleven services choose none.
- **Cache aggressively.** Rate calls cost money and are slow.

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

Tiers 1 and 2 are self-contained and need no third-party account, so they
should land first and will satisfy most stores. Tier 3 is a separate,
opt-in integration behind a provider interface (`ShippingProvider`) so Shippo
and EasyPost are interchangeable and neither is required to run Beluga.

Sources: [Stripe dynamic shipping](https://docs.stripe.com/payments/advanced/shipping),
[Stripe shipping rates API](https://docs.stripe.com/api/shipping_rates),
[EasyPost vs Shippo vs ShipStation](https://www.easypost.com/easypost-vs-shippo-vs-shipstation/).
