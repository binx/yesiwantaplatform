import { Link } from "react-router-dom";
import { Button } from "antd";
import { formatMoney } from "@shared/money";
import { artistShareCents } from "@shared/schema";
import { DELIVERY_ESTIMATE } from "@shared/copy";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useStore } from "@/lib/useStore";
import { useCustomer } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./ForArtistsPage.module.css";

/**
 * The pitch to an artist, readable by anyone.
 *
 * `/studio/new` sits behind the studio gate, so a signed-out visitor who
 * clicked "For artists" used to land on a sign-in form with nothing about
 * artists on it. This page is what the link promises: what the offer is,
 * what it pays, what we do and what they never have to. The sign-in comes at
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
  /* A worked example: a round price above the floor, so the arithmetic is
   * easy to follow and the share is never a zero. */
  const exampleCents = Math.max(pricing.minMonthlyPriceCents, 500);
  const isArtist = Boolean(customer.data?.artistSlug);

  return (
    <PageWrapper width="prose">
      <p className={styles.kicker}>For artists</p>
      <h1 className={styles.heading}>Share your art, build an audience</h1>
      <p className={styles.lede}>
        Your best work deserves better than a feed. Once a month, put one picture and a few words in the hands of the people who want
        to hear from you — no algorithm, nothing online, just a card that arrives.
      </p>

      <section className={styles.section}>
        <h2>How it works</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Open a studio.</strong> Make your page at your own address, write a line about what you send, and set your own
            monthly price. It starts as a draft; nobody sees it until you go live.
          </li>
          <li>
            <strong>Queue a card a month.</strong> A photo you took on the front, your note on the back. Pick the day of the month it
            goes out.
          </li>
          <li>
            <strong>We do the rest.</strong> On the mailing day we print your card and post one to every subscriber. {DELIVERY_ESTIMATE}
          </li>
        </ol>
      </section>

      <section className={styles.section}>
        <h2>What it pays</h2>
        <p>
          You set the price, from {money(pricing.minMonthlyPriceCents)} a month. Each month, for every subscriber, printing and postage
          take {money(pricing.printCostCents)} and our fee takes {money(pricing.platformFeeCents)}. The rest is yours, sent to your
          bank through Stripe once the month's cards are in the post.
        </p>
        <dl className={styles.example} aria-label={`What a ${money(exampleCents)} subscription pays`}>
          <div>
            <dt>A subscriber pays</dt>
            <dd>{money(exampleCents)}</dd>
          </div>
          <div>
            <dt>Printing, postage and our fee</dt>
            <dd>&minus;{money(costCents)}</dd>
          </div>
          <div className={styles.exampleTotal}>
            <dt>You keep</dt>
            <dd>{money(artistShareCents(exampleCents, pricing))}</dd>
          </div>
        </dl>
        <p className={styles.note}>Per card, per subscriber, every month. Changing your price later affects new subscribers only.</p>
      </section>

      <section className={styles.section}>
        <h2>What you never have to do</h2>
        <ul className={styles.list}>
          <li>
            <strong>Handle addresses.</strong> Subscribers give their address to us, and we print and mail every card. You see a
            name and a town, never a street.
          </li>
          <li>
            <strong>Chase payments.</strong> Subscriptions renew on their own. When someone cancels, they simply stop getting cards.
          </li>
          <li>
            <strong>Launch before you are ready.</strong> Your page stays a draft until you say otherwise, and it cannot go live until
            there is a card in the queue, so a subscriber's first month always has something in it.
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
