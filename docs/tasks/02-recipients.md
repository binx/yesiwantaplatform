---
task: "02"
title: "Recipients: CSV matching, address verification, international"
status: in-progress
tier: 1
size: L
migration: columns on postcards, customer_addresses, store_settings, orders
blocked_by: []
blocks: ["04"]
touches: src/lib/recipients-csv.ts · shared/csv.ts:78 · shared/postcards.ts:78 · server/lob.ts · src/components/postcard/Recipients.tsx · server/routes/checkout.ts
completed:
shipped_in: 5
summary: >-
  Three things about who a card goes to. **A:** the CSV importer wants exact column names
  and refuses a whole file for one bad row; make it read what spreadsheets actually export.
  **B:** a typo in a ZIP is discovered by Lob after payment; verify with Lob's endpoint
  while the buyer is still looking at the field, and offer USPS's corrected form. **C:**
  postcards are US-only; open the recipient form, the CSV, pricing and the sweep to Lob's
  international destinations.
---

# 02 · Recipients: CSV matching, address verification, international

## Progress

- **A** built. Headers are normalised and matched against an alias table
  (first + last name join), the byte-order mark is stripped, semicolons are
  detected, the modal previews the mapping and the first rows before
  importing, good rows import while bad ones are listed with Edit/Skip and
  a four-digit ZIP gets the leading-zero message.
- **B** built. `verifyRecipient` in `server/lob.ts` (US verifications, a
  day's cache, `unknown` on any failure), `POST /api/recipients/verify`
  behind `verifyRateLimit`, `customer_addresses.verified_at`, and the shared
  `RecipientFields` + `VerificationNotice` used by the designer and the
  account page. A refused address keeps the batch out of the cart.
- **C** not started.

Three parts. **A and B ship independently. C depends on both**: it adds a
country column to the CSV and needs the verification call to pick Lob's
international endpoint.

## Part A · CSV headers that match what people have

### The problem

`parseRecipientsCsv` (`src/lib/recipients-csv.ts`) accepts a short alias
list — `address`, `zip`, `postal_code` — and otherwise reports "Missing
column". Three things a real export does defeat it:

- **Excel writes a byte-order mark.** The first header arrives as
  `﻿name`, matches nothing, and the file is refused with a message
  about a missing `name` column that is plainly there. `CsvStreamParser`
  does not strip it (`shared/csv.ts:78`); the writer side adds one on
  purpose (`CSV_BOM`), so a file this site exported is refused by this site.
- **Headers have spaces and capitals.** "Street Address", "Zip Code",
  "State/Province", "First Name" + "Last Name" all fail the exact lookup.
- **One bad row refuses the file.** A 200-row list with one missing city
  imports nothing; the buyer fixes the spreadsheet and re-uploads.

### What to build

1. **Normalise headers**: strip a leading BOM from the text before parsing;
   lowercase; drop everything that is not `[a-z0-9]`. Match on that. The
   alias table becomes:

   ```ts
   const ALIASES: Record<string, keyof Recipient | "firstName" | "lastName" | "country"> = {
     name: "name", fullname: "name", recipient: "name", recipientname: "name", to: "name",
     firstname: "firstName", givenname: "firstName",
     lastname: "lastName", surname: "lastName", familyname: "lastName",
     address: "line1", address1: "line1", addressline1: "line1", street: "line1",
     streetaddress: "line1", street1: "line1", line1: "line1",
     address2: "line2", addressline2: "line2", apt: "line2", apartment: "line2",
     suite: "line2", unit: "line2", street2: "line2", line2: "line2",
     city: "city", town: "city", addresscity: "city",
     state: "state", province: "state", region: "state", stateprovince: "state", addressstate: "state",
     zip: "postalCode", zipcode: "postalCode", postalcode: "postalCode", postcode: "postalCode",
     postal: "postalCode", addresszip: "postalCode",
     country: "country", countrycode: "country",  // used by Part C; ignored until then
   };
   ```

   `firstName` + `lastName` join with a space into `name`. A header that
   matches nothing is *ignored*, not fatal — the "Missing column" error only
   fires for a required field with no source.

2. **Delimiter**: if the header line has more `;` than `,`, parse with `;`.
   `CsvStreamParser` takes an optional delimiter in its constructor; the
   admin export keeps writing commas.

3. **Report the mapping.** `parseRecipientsCsv` returns
   `{ recipients, problems, mapping: { header: field }[], ignored: string[] }`.
   The modal in `Recipients.tsx` shows, before importing, a compact preview:
   "We read *Street Address* as the street, *Zip Code* as the ZIP" and, if
   any, "Ignored: *Email*, *Phone*", with the first three parsed rows
   underneath and an **Import N recipients** button. This one screen catches
   the mis-mapped column that would otherwise print 200 cards with the city
   in the name field.

4. **Import the good rows.** Rows that fail `recipientSchema` are listed
   with their line number and reason, as now, but the valid rows are
   imported. Each bad row gets an **Edit** button that loads it into the
   recipient form above (the `draft` state) so it can be fixed by hand.

5. **Say what Excel did.** A four-digit ZIP gets the message "ZIP has 4
   digits — Excel may have dropped a leading zero", not the generic regex
   message. Do not guess the zero; a wrong guess prints.

6. The sample CSV is fine as it is; leave `SAMPLE_CSV` alone so v1 users'
   files keep working.

### Acceptance (A)

- A file exported from Excel with a BOM and "First Name, Last Name, Street
  Address, City, State, Zip Code" columns imports without editing.
- A semicolon-delimited file imports.
- A 20-row file with one bad row imports 19 and shows the one, with Edit.
- The mapping preview appears before anything is added to the list.

## Part B · Address verification before the cart

### The problem

`docs/NEXT-STEPS.md` §3 says it: "A typo in a ZIP goes to Lob and comes
back as a refusal on the order after payment." The buyer has paid, the card
is parked in `error`, the admin sees Lob's words, and somebody has to email
somebody. Lob's verification endpoints answer in a second, before the money.

### What to build

1. **Lob client**, in `server/lob.ts`. A JSON `post` alongside the multipart
   one, and:

   ```ts
   export type Deliverability =
     | "deliverable" | "deliverable_unnecessary_unit" | "deliverable_incorrect_unit"
     | "deliverable_missing_unit" | "undeliverable" | "unknown";

   export interface Verification {
     deliverability: Deliverability;
     /** The address in USPS's form, when Lob returned one. Null when undeliverable. */
     suggested: Recipient | null;
     /** Whether `suggested` differs from what was sent, ignoring case and punctuation. */
     changed: boolean;
   }

   export async function verifyRecipient(recipient: Recipient): Promise<Verification>;
   ```

   US: `POST /v1/us_verifications` with `primary_line`, `secondary_line`,
   `city`, `state`, `zip_code`; read `deliverability`, `primary_line`,
   `secondary_line`, `components.city`, `components.state`,
   `components.zip_code` (+ `zip_code_plus_4`). Lob's sub-codes
   (`undeliverable_no_match` and friends) all collapse to `undeliverable`.
   Part C adds `POST /v1/intl_verifications` (fields: `primary_line`,
   `secondary_line`, `city`, `state`, `postal_code`, `country`; answers
   `deliverable` / `undeliverable` only).

   **Lob down is not a refusal.** A `LobError` with status 0 or 5xx returns
   `{ deliverability: "unknown", suggested: null, changed: false }`; the
   caller lets the buyer proceed. Verification must never be what stops a
   sale.

   This is the one place outside the sweep that calls Lob, and it is a read.
   Invariant 7 is about *sending*; note the exception in the module comment.

2. **A cache** in front of it: an in-memory `Map` keyed on the normalised
   address, 24-hour TTL, capped at a few thousand entries. Lob bills
   verifications past the plan's free allowance, and a buyer re-adding the
   same friend, or a 500-row CSV uploaded twice, should not pay twice.

3. **Route**: `POST /api/recipients/verify`, body `recipientSchema`, answers
   `Verification`. Public — guests check out — so it carries its own
   limiter, `verifyRateLimit`, in `server/middleware.ts`: 120 per hour per
   IP, generous enough for a bulk upload and small enough that the endpoint
   is not a free verifier for the internet. Add it to `server/security.test.ts`
   with a case that the limiter answers 429.

4. **In the form** (`Recipients.tsx`): on submit, after `recipientSchema`
   passes, call verify and branch:

   | Result | What the buyer sees |
   |---|---|
   | `deliverable`, unchanged | Added, as now. |
   | `deliverable`, changed | An inline card: "USPS knows this address as: …" with **Use this** (adds the suggestion) and **Keep mine**. |
   | `deliverable_*_unit` | The same card, warning tone, with the reason in plain words ("USPS thinks this building needs an apartment number"). Both buttons. |
   | `undeliverable` | Error tone: "USPS doesn't recognise this address. Check the street number and ZIP." No add button — Lob will refuse it after payment, so refusing it now is the kinder of the two. |
   | `unknown` | Added, with no message. |

   Extract the form fields into a `RecipientFields` component so the
   account's `AccountAddressesPage`, the CSV fix-up flow and brief 04B's
   public form all get the same behaviour. Antd `Alert` for the card, in the
   `.recipientForm` column.

5. **CSV**: after import, verify rows in sequence (four at a time, with the
   cache) and mark each list item with a small status: ✓, "suggested"
   (click to see and apply), or "check this". An **Apply all suggestions**
   button for the deliverable-with-changes set. A row marked undeliverable
   stays in the list but the **Add to cart** button is disabled until it is
   fixed or removed, with the count shown ("2 addresses need checking").

6. **Saved recipients** (`customer_addresses`) gain `verified_at`
   (timestamp, nullable; both dialects) set when an address was added via a
   deliverable verification or accepted a suggestion. The picker skips
   verification for those; the account page shows a small "Verified" chip
   and re-verifies on edit.

7. **Admin**: `docs/NEXT-STEPS.md` §3 gets its "No address verification"
   line removed. The Retry button stays for the refusals that still happen.

### Acceptance (B)

- "185 Berry St, San Francisco CA 94107" is accepted unchanged; "185 berry
  street" comes back suggested as USPS's form and one click applies it.
- A ZIP that does not match the city is refused before the list.
- With `LOB_API_KEY` unset, or Lob answering 500, the form behaves exactly
  as before this change.
- 120 verifications in an hour from one IP answers 429 on the 121st.
- A verified saved recipient is not re-verified when picked.

## Part C · International recipients

### The problem

`recipientSchema` (`shared/postcards.ts:78`) enforces a two-letter US state
and a five-digit ZIP, and `sendPostcard` hard-codes
`to[address_country] = "US"`. Lob mails 4×6 postcards to 240-odd countries.

What Lob requires abroad, confirmed against its documentation:

- Only the `4x6` size, which is all this site sells.
- `mail_type` must be `usps_first_class`, which is what is sent.
- `address_country` as an ISO 3166-1 alpha-2 code.
- **A US `from` address is required on every international piece.** The
  site currently sends none.
- Expect an extra five to seven business days.
- A country under a postal suspension answers 422 at creation time.

### What to build

1. **Schema.** `recipientSchema` gains
   `country: z.string().trim().toUpperCase().length(2).default("US")` and
   the state and postal rules become conditional in a `superRefine`: for
   `US` exactly as today; otherwise `state` optional (max 64) and
   `postalCode` optional (max 20), both trimmed. `formatRecipient` appends
   the country name when it is not US. Both dialects:

   - `postcards.recipient_country` text not null default `'US'`.
   - `customer_addresses.country` already exists; stop hard-coding `"US"` in
     `createAddress`.
   - `store_settings.return_address` (JSON; sqlite text) nullable, and
     `store_settings.international_postcard_price_cents` integer nullable.
     Null means international is off.
   - `orders.international_count` integer not null default 0 and
     `orders.international_unit_price_cents` integer nullable — the second
     snapshot, next to `unit_price_cents`, so an order's arithmetic still
     reconstructs after the price moves.

2. **Settings → Printing** (`src/admin/SettingsPage.tsx`): a return address
   form (name, street, city, state, ZIP — US only, verified through Part B)
   and an international price. The environment warning on the admin
   overview gains "International postcards are on but no return address is
   set" — the sweep would otherwise park every foreign card.

3. **The form.** A country `Select` at the top of `RecipientFields`,
   defaulting to US, options built from a static ISO code list with names
   from `Intl.DisplayNames` in the store's locale (no dependency). When the
   country is not US the labels become "State / province" and "Postal
   code", neither required. The CSV alias `country` becomes live; a missing
   column means US.

4. **Pricing.** `countPostcards` grows a sibling,
   `countPostcardsByDestination(lines) → { domestic, international }`. The
   designer's total shows two lines when both are non-zero. Checkout sends
   two Stripe line items when `international > 0`, each with its own
   `price_data`; both prices come from settings, never the cart (invariant
   2). If the store has no international price and a line has a foreign
   recipient, `assertOrderable` answers 409: "This shop can't mail abroad
   yet." The order pages (`AccountOrderDetailPage`, `ConfirmPage`, admin)
   render the second line and the CSV export gains a country column.

5. **The sweep.** `sendPostcard` sends `to[address_country]` from the
   recipient and, when it is not US, the `from[…]` fields from the store's
   return address. No return address configured → the card is parked with
   *our* sentence ("No return address is set; international mail needs
   one") — invariant 8 is about Lob's words; this is not a Lob refusal.
   `LobError` from a 422 stays verbatim as now.

6. **Verification** (Part B) routes non-US recipients to
   `intl_verifications`. `deliverable`/`undeliverable` only; no suggestions.

7. **Expectations.** No arrival is promised anywhere (brief 00, amended). The schedule note reads "International
   cards take about two weeks longer" when a foreign recipient is on the
   list. The `PostcardSent` email already shows Lob's
   `expected_delivery_date`, which accounts for the destination.

### Acceptance (C)

- A Canadian recipient with a postal code and a province, and a UK one with
  neither field required, both pass the schema and reach checkout.
- Checkout for two US and one Canadian card produces one Stripe session
  with two line items at the two configured prices, and the order records
  both counts.
- With no return address, checkout refuses the foreign card before Stripe;
  with one set, the sweep sends `from[…]`.
- `db/dialect.test.ts` covers the four new columns on both engines.

## Tests to add

- `src/lib/recipients-csv.test.ts`: BOM, mixed-case spaced headers,
  first+last name, semicolons, one bad row among good ones, the four-digit
  ZIP message, a `country` column.
- `server/lob.test.ts`: `verifyRecipient` maps each Lob deliverability
  value; a 500 yields `unknown`; the cache serves the second identical call
  without a fetch.
- A route test for `/api/recipients/verify` (public, rate-limited).
- `shared/postcards.test.ts`: the conditional state/postal rules;
  `countPostcardsByDestination`.
- `server/checkout.test.ts`: two line items; refusal without a return
  address; refusal without an international price.
- `server/fulfilment.test.ts`: an international card carries `from`.
- e2e: the country select changes the labels and a Canadian address reaches
  the cart.

## Out of scope

- Non-Latin scripts on the address. Lob accepts UTF-8, but the print faces
  do not have the glyphs for the message; the address is Lob's overlay and
  is fine. Say nothing until someone asks.
- A per-country price table. One international price.
- Sending *from* outside the US. Lob requires a US return address.
