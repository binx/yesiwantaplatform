import { Link } from "react-router-dom";
import { Button } from "antd";
import { formatMoney } from "@shared/money";
import { artistShareCents, cardGrossCents } from "@shared/schema";
import { EDITION_SIZES } from "@shared/platform";
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
 * clicked through used to land on a sign-in form with nothing about artists
 * on it. This page is what the link promises, kept short: the process as a
 * four-step line, the money as a receipt, and the one button that needs a
 * sign-in at the end.
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

  const steps = [
    {
      title: "Open a studio",
      text: "Your own page, at your own address. It stays a draft until you go live.",
    },
    {
      title: "Make an edition",
      text: `${EDITION_SIZES.join(" or ")} postcards: your picture on the front, your note on the back. One price for the set.`,
    },
    {
      title: "Collectors buy it",
      text: "Paid once, up front. They pick how often the cards come and where they go.",
    },
    {
      title: "We print and post",
      text: "Every card on its day, from our printer, and you are paid for each one. You see a name and a town, never an address.",
    },
  ];

  return (
    <PageWrapper>
      <p className={styles.kicker}>For artists</p>
      <h1 className={styles.heading}>Put your pictures in the post</h1>
      <p className={styles.lede}>
        Turn a set of your pictures into postcards. We print and mail them to the people who want them, one card at a time, and
        pay you for each one.
      </p>

      <section className={styles.section}>
        <h2>How it works</h2>
        <ol className={styles.flow}>
          {steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden>
                {index + 1}
              </span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={cx(styles.section, styles.pay)}>
        <div>
          <h2>What it pays</h2>
          <p>
            You set the price of the set, from {money(pricing.minCardPriceCents)} a card. For every card we send, printing and
            postage take {money(pricing.printCostCents)} and our fee takes {money(pricing.platformFeeCents)}. The rest goes to your
            bank through Stripe as that card goes out.
          </p>
        </div>
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
