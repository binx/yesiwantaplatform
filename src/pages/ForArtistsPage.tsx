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
 * The pitch to an artist, readable by anyone, at /open-a-studio.
 *
 * `/studio/new` sits behind the studio gate, so a signed-out visitor who
 * clicked through used to land on a sign-in form with nothing about artists
 * on it. This page is what the link promises, kept short: the process as a
 * three-step line, the money as one worked example, and the one button that
 * needs a sign-in at the end.
 *
 * The example is computed from settings — the same `pricing` the studio's
 * price field enforces and the payout ledger applies — so this page cannot
 * drift out of agreement with what an artist is actually paid. It shows the
 * set's price, what comes out of it, and what is left; the split between
 * printing and our fee stays our business.
 */
export function ForArtistsPage() {
  const store = useStore();
  const customer = useCustomer();

  const { pricing, currency, locale } = store;
  const money = (cents: number) => formatMoney(cents, currency, locale);
  /* A worked example: a six-card edition at a round price per card above the
   * floor, so the arithmetic is easy to follow and the share is never a zero.
   * Each card's share comes from `cardGrossCents`, as the ledger's does. */
  const examplePriceCents = Math.max(pricing.minCardPriceCents, 500) * EXAMPLE_SIZE;
  const exampleShareCents = Array.from({ length: EXAMPLE_SIZE }, (_, i) =>
    artistShareCents(cardGrossCents(examplePriceCents, EXAMPLE_SIZE, i + 1), pricing),
  ).reduce((sum, cents) => sum + cents, 0);
  const exampleCostCents = examplePriceCents - exampleShareCents;
  const keptPercent = Math.round((exampleShareCents / examplePriceCents) * 100);
  const isArtist = Boolean(customer.data?.artistSlug);

  const steps = [
    {
      title: "Open a studio, make an edition",
      text: `Your own page, at your own address, with ${EDITION_SIZES.join(" or ")} postcards on it at one price for the set.`,
    },
    {
      title: "Collectors buy it",
      text: "Paid once, up front. They pick how often the cards come and where they go.",
    },
    {
      title: "We print and post",
      text: "Every card goes out on its day, from our printer to their letterbox.",
    },
  ];

  return (
    <PageWrapper>
      <h1 className={styles.heading}>Put your pictures in the post</h1>
      <p className={styles.lede}>
        Share your art with the world and put a little delight in someone's letterbox. Your pictures become real postcards, mailed
        one at a time to the people who want them.
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

      <section className={styles.section}>
        <h2>Example pricing</h2>
        <div className={styles.example} role="group" aria-label={`What a ${money(examplePriceCents)} edition of ${EXAMPLE_SIZE} pays`}>
          <dl className={styles.receipt}>
            <div>
              <dt>A collector pays, for {EXAMPLE_SIZE} cards</dt>
              <dd>{money(examplePriceCents)}</dd>
            </div>
            <div>
              <dt>Printing, postage and our fee</dt>
              <dd>&minus;{money(exampleCostCents)}</dd>
            </div>
          </dl>
          {/* The price as a bar, with the artist's part of it lit. */}
          <div className={styles.split} aria-hidden>
            <span className={styles.splitKept} style={{ width: `${keptPercent}%` }} />
          </div>
          <p className={styles.keep}>
            <span className={styles.keepLabel}>You keep</span>
            <span className={styles.keepAmount}>{money(exampleShareCents)}</span>
            <span className={styles.keepNote}>{keptPercent}% of the price</span>
          </p>
        </div>
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
          <Link to="/studio/new">
            <Button type="primary" size="large" className={cx(styles.actionButton)}>
              Open a studio
            </Button>
          </Link>
        )}
      </section>
    </PageWrapper>
  );
}
