import { Link } from "react-router-dom";
import { Button } from "antd";
import { formatMoney } from "@shared/money";
import { artistShareCents, cardGrossCents } from "@shared/schema";
import { EDITION_SIZES } from "@shared/platform";
import { DELIVERY_ESTIMATE } from "@shared/copy";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useStore } from "@/lib/useStore";
import { useCustomer } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./ForArtistsPage.module.css";

/** The worked example's edition: the smaller of the two sizes. */
const EXAMPLE_SIZE = EDITION_SIZES[0];

/**
 * The pitch to an artist, readable by anyone.
 *
 * `/studio/new` sits behind the studio gate, so a signed-out visitor who
 * clicked "For artists" used to land on a sign-in form with nothing about
 * artists on it. This page is what the link promises: what the offer is,
 * what it pays per card, what we do and what they never have to. The sign-in comes at
 * the end, at the one button that needs it.
 *
 * Every number is read from settings — the same `pricing` the studio's price
 * field enforces and the payout ledger applies — so this page cannot drift
 * out of agreement with what an artist is actually paid.
 */
export function ForArtistsPage() {
  const store = useStore();
  const customer = useCustomer();

  const { pricing, currency, locale } = store;
  const money = (cents: number) => formatMoney(cents, currency, locale);
  const costCents = pricing.printCostCents + pricing.platformFeeCents;
  /* A worked example: a six-card edition at a round price per card above the
   * floor, so the arithmetic is easy to follow and the share is never a zero.
   * Each card's part comes from `cardGrossCents`, as the ledger's does. */
  const examplePriceCents = Math.max(pricing.minCardPriceCents, 500) * EXAMPLE_SIZE;
  const exampleShareCents = Array.from({ length: EXAMPLE_SIZE }, (_, i) =>
    artistShareCents(cardGrossCents(examplePriceCents, EXAMPLE_SIZE, i + 1), pricing),
  ).reduce((sum, cents) => sum + cents, 0);
  const isArtist = Boolean(customer.data?.artistSlug);

  return (
    <PageWrapper width="prose">
      <p className={styles.kicker}>For artists</p>
      <h1 className={styles.heading}>Share your art, build an audience</h1>
      <p className={styles.lede}>
        Your best work deserves better than a feed. Put a set of pictures and a few words in the hands of the people who want to
        hear from you, one card at a time — no algorithm, nothing online, just a card that arrives.
      </p>

      <section className={styles.section}>
        <h2>How it works</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Open a studio.</strong> Make your page at your own address and write a line about what you send. It starts as a
            draft; nobody sees it until you go live.
          </li>
          <li>
            <strong>Make an edition.</strong> {EDITION_SIZES.join(" or ")} cards, a photo you took on each front and your note on each
            back, sent once a month or twice a month. You set one price for the set, and collectors pay it up front. Make as many
            editions as you like.
          </li>
          <li>
            <strong>We do the rest.</strong> Each collector picks the day their first card goes, and we print and post every card
            on their schedule. {DELIVERY_ESTIMATE}
          </li>
        </ol>
      </section>

      <section className={styles.section}>
        <h2>What it pays</h2>
        <p>
          You set the price of the whole edition, from {money(pricing.minCardPriceCents)} a card. It's split evenly across the cards,
          and for every card we send, printing and postage take {money(pricing.printCostCents)} and our fee takes{" "}
          {money(pricing.platformFeeCents)}. The rest is yours, sent to your bank through Stripe once that card is in the post.
        </p>
        <dl className={styles.example} aria-label={`What a ${money(examplePriceCents)} edition of ${EXAMPLE_SIZE} pays`}>
          <div>
            <dt>A collector pays, for {EXAMPLE_SIZE} cards</dt>
            <dd>{money(examplePriceCents)}</dd>
          </div>
          <div>
            <dt>Each card's part</dt>
            <dd>{money(cardGrossCents(examplePriceCents, EXAMPLE_SIZE, 2))}</dd>
          </div>
          <div>
            <dt>Printing, postage and our fee</dt>
            <dd>&minus;{money(costCents)}</dd>
          </div>
          <div>
            <dt>You keep, per card</dt>
            <dd>{money(artistShareCents(cardGrossCents(examplePriceCents, EXAMPLE_SIZE, 2), pricing))}</dd>
          </div>
          <div className={styles.exampleTotal}>
            <dt>You keep, for the set</dt>
            <dd>{money(exampleShareCents)}</dd>
          </div>
        </dl>
        <p className={styles.note}>
          Paid as each card goes out. An edition's price is fixed once it's on sale, because that's what its collectors paid for.
        </p>
      </section>

      <section className={styles.section}>
        <h2>What you never have to do</h2>
        <ul className={styles.list}>
          <li>
            <strong>Handle addresses.</strong> Collectors give their address to us, and we print and mail every card. You see a name
            and a town, never a street.
          </li>
          <li>
            <strong>Chase payments.</strong> Collectors pay for the whole edition before the first card goes. Nothing renews, and
            there's nothing to chase.
          </li>
          <li>
            <strong>Launch before you are ready.</strong> Your page stays a draft until you say otherwise, and an edition can't go on
            sale until every one of its cards is in it, so every collector gets the whole set.
          </li>
        </ul>
      </section>

      <section className={cx(styles.section, styles.action)}>
        {isArtist ? (
          <>
            <Link to="/studio">
              <Button type="primary" size="large" className={cx(styles.actionButton)}>
                Go to your studio
              </Button>
            </Link>
            <p className={styles.note}>You already have one.</p>
          </>
        ) : (
          <>
            <Link to="/studio/new">
              <Button type="primary" size="large" className={cx(styles.actionButton)}>
                Open a studio
              </Button>
            </Link>
            {customer.data ? null : <p className={styles.note}>You'll sign in or create an account first. It takes a minute.</p>}
          </>
        )}
      </section>
    </PageWrapper>
  );
}
