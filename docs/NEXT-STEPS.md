# Next steps

Written 2026-09-09, at the end of the session that forked Beluga v2 into this
repo. Read this before picking the project back up; `CLAUDE.md` has the rules,
this has the work.

## Where things stand

The fork is complete and green: typecheck, lint, 252 unit tests (both SQLite
and Postgres), 53 Playwright tests. The app runs locally with a Lob test key
in `.env`, and the setup wizard has not yet been completed on the local
database. Nothing has been sent to Lob or Stripe from this codebase yet —
every integration test so far ran against fakes.

What v1 had that is now built:

- The designer (`/create`): photo, back message, schedule, recipients, CSV.
- Print-ready files made on upload at Lob's size, landscape, 300 dpi declared.
- A fulfilment sweep that sends due cards to Lob and stores Lob's refusal
  verbatim, with Retry and Withdraw in the admin.
- Order confirmation and per-card "went to print" emails.

What v2 added over v1: customer accounts with saved recipients, abandoned-cart
reminders, refunds from the admin, Markdown pages, an editable price, a test
button for both email and Lob.

## 1. Prove Lob works (needs you)

Finish the setup wizard, then Admin → Settings → Printing → **Send a test
postcard**. Read what Lob says. Three things it may object to, in order of
likelihood:

- **`use_type`.** Lob requires it on every mailpiece for accounts created
  since 2023. It is sent as `operational` (`LOB_USE_TYPE` in `.env`). If Lob
  wants `marketing` for your account, change the variable.
- **The front file.** It is sent as a multipart PNG at 1875 × 1275 with 300
  dpi declared. If Lob reports a size problem, the answer is in
  `server/lob.ts`'s `printFile`, and the density metadata is the first thing
  to check with `sharp(bytes).metadata()`.
- **The back HTML.** `print/back.hbs` loads the three faces from Google Fonts
  with a `<link>`. If Lob's renderer refuses that, the fallback is your v1
  template: set `LOB_BACK_TEMPLATE_ID=tmpl_…` and the same merge variables
  v1 sent are used instead.

Once a test card is accepted, open the proof URL Lob returns and check the
back's layout against a real Lob-rendered card: the message column is 2.8 in
wide on the left and the address block is Lob's own overlay on the right.
Adjust `print/back.hbs` and `src/components/postcard/PostcardBackMock.tsx`
together — they share the same inch measurements on purpose.

## 2. Prove Stripe works end to end

Put `sk_test_…` and `pk_test_…` in `.env`, then:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Copy the `whsec_…` it prints into `.env`, restart the API, design a card
dated today, and pay with `4242 4242 4242 4242`. Expected, in order: the
confirmation page flips from "confirming" to the schedule; the order appears
in the admin as In progress; within a few seconds the sweep the webhook kicks
sends the card to Lob's sandbox and the row turns to Sent to Lob; the order
becomes Completed. With SMTP unset, both emails are printed to the API log
instead of sent.

## 3. Things assumed, not confirmed

- **The "free postcards" admin route is back** (ported after this was first
  written): an admin signed in on `/create` sees "Send for free (admin)",
  which posts to `POST /api/admin/orders/complimentary`. Same checks as
  checkout, no Stripe, order written straight to `paid` at a total of zero.
- **Google Analytics was dropped.** v1's `UA-` property no longer exists.
  Add GA4 or a privacy-friendlier counter during the design pass if you want
  numbers.
- **Postcards are US only until you set an international price** in
  Settings → Printing, together with the shop's own US return address, which
  Lob prints on every card mailed abroad. Nothing has been sent abroad from
  this codebase yet; Lob answers 422 for a destination under a postal
  suspension, and that refusal lands on the card in the admin like any other.
- **Old orders were not migrated** from the v1 Postgres database.

## 4. The design pass

Everything renders in Beluga's default look with v1's copy dropped in:
the CMYK accent blocks on the landing page, the Sacramento section headings,
the yellow accent. The theme editor already controls palette, radius, font
stack and the Google Fonts stylesheet, so much of the pass can happen in
Settings → Look before touching CSS. The files that are yours to restyle
freely are `src/index.css`, `src/pages/LandingPage.module.css`,
`src/pages/CreatePage.module.css` and `src/components/postcard/Postcard.module.css`.
The postcard back mock and the safe-area frame in the designer are the two
places where a layout change has to stay in step with the print pipeline.

## 5. Deploying

The v1 box was an Ubuntu VM with nginx, pm2 and Postgres, deployed by
`git push production`. The same shape works here, or any host with a
persistent disk:

- Node 22. `npm run build` compiles the server to `dist-server/` and the
  client to `dist/`; `npm start` runs it.
- `.env` in production needs `SESSION_SECRET`, `PUBLIC_URL`, the Stripe
  keys, the Stripe webhook secret (a real endpoint in the Stripe dashboard
  pointed at `/api/webhooks/stripe`), `LOB_API_KEY` (a `live_` key), and
  `SMTP_URL` plus `EMAIL_FROM`.
- Two things must persist: the SQLite file in `data/` (or set
  `DATABASE_URL` to Postgres) and `ASSETS_DIR`, which holds every design's
  print file. Or use the `ASSETS_S3_*` bucket settings.
- There is no cron to install. The sweep runs inside the API process every
  fifteen minutes and once at boot; pm2 keeping the process alive is enough.
- The admin overview warns about every one of these when it is missing:
  localhost public URL, no webhook secret, test Lob key next to a live
  Stripe key, no email.

## 6. Mobile

Every page already has a narrow-screen layout and the Playwright `mobile`
project scans each route on a Pixel 7, so nothing is broken on a phone. But
the designer was laid out desktop-first, and a phone is where a photo of the
grandchildren is most likely to be. The pass, in order of payoff:

- **The back-of-card mock is a fixed 468px wide**
  (`src/components/postcard/PostcardBackMock.tsx`). On a 375px screen it
  overflows. Make it fluid: measure the container, scale the card and its
  point-to-pixel factor from that width. The inch geometry stays the same.
- **The front preview and the safe-area frame** should fill the width on a
  phone, with the orientation switch and the upload button under it rather
  than beside it. `Postcard.module.css` already collapses the grid at 800px;
  check the frame's 4% border still reads as a safe zone at that size.
- **The recipient form** stacks fine; the city/state/ZIP row needs to become
  two rows below about 400px, and the list of added recipients should sit
  above the form on a phone so what you just added is visible.
- **The total and "Add to cart"** should be a sticky bar at the bottom of the
  designer on small screens, so the price is visible while scrolling a long
  recipient list.
- **The cart line** already reflows; verify the thumbnails row and the
  recipients disclosure on a 375px width.
- **Photo upload from the camera roll** works through the plain file input;
  add `capture` only if you want to offer the camera directly, since iOS
  then hides the library.
- Test with the browser pane's mobile preset and the Playwright mobile
  project; add a storefront e2e that drives the whole designer at that size.

## 7. Content moderation for uploaded photos

Anyone can upload a photo and pay to have it printed and mailed to a
stranger. Lob's terms put the responsibility on the sender, and there is
currently nothing between the upload and the printer except the admin's
eyes. Options, cheapest first:

- **Hold for review, no model.** Add a `held` state on postcards: the sweep
  skips any card whose design has not been approved, and the admin overview
  lists designs awaiting a look with a thumbnail and Approve/Reject buttons.
  Free, and at this shop's volume a glance a day. The cost is delay on
  same-day cards. Half a day's work.
- **A free-tier cloud check at upload time.** Google Vision SafeSearch,
  AWS Rekognition moderation and Azure Content Safety each have a free
  monthly allowance well above this shop's volume (roughly a thousand to
  five thousand images a month), then about a dollar per thousand. One call
  in `server/routes/designs.ts` after the image is decoded; a "likely" or
  "very likely" adult/violence verdict marks the design for review rather
  than refusing it outright, so a false positive on a beach photo does not
  turn a customer away. Needs a cloud account and a key in `.env`. A day,
  including the review UI above, which it should feed into rather than
  replace.
- **A local open-source model.** `nsfwjs` runs a small MobileNet in Node and
  costs nothing per image, but it is nudity-only, weak on violence and text,
  and pulls in TensorFlow. Fine as a first filter in the browser before
  upload, not as the only gate.

Recommendation: build the review hold first, since it is free and the human
is the real check, then add the cloud classifier to sort the queue so most
designs are auto-approved and only the flagged ones wait. Both are on the
same rows, so the second step is small once the first exists.

## 8. Smaller loose ends

- Playwright covers the storefront, admin pages and the wizard's first step,
  but not the account pages signed in or the cart-recovery link. Worth adding
  once the flows settle.
- `README.md` describes the system; the docs site for Beluga does not apply
  to this fork.
- Beluga can be pulled from `upstream` for fixes to the parts this repo kept
  (accounts, email, image store, session handling), but expect conflicts in
  anything catalogue-shaped.
