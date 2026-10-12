import { Link } from "react-router-dom";
import { Button } from "antd";
import { formatMoney } from "@shared/money";
import { artistShareCents, cardGrossCents, platformFeeCentsFor } from "@shared/schema";
import { EDITION_SIZES } from "@shared/platform";
import { ARTIST_PITCH, ARTIST_STEPS } from "@shared/copy";
import { usePageTitle } from "@/lib/usePageTitle";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useStore } from "@/lib/useStore";
import { useCustomer } from "@/lib/account";
import { cx } from "@/lib/cx";
import styles from "./ForArtistsPage.module.css";

/**
 * The pitch to an artist, readable by anyone, at /open-a-studio.
 *
 * `/studio/new` sits behind the studio gate, so a signed-out visitor who
 * clicked through used to land on a sign-in form with nothing about artists
 * on it. This page is what the link promises, kept short: a button straight
 * away, the process as a three-step line, the money as one worked example
 * per edition size, and the button again at the end.
 *
 * The examples are computed from settings — the same `pricing` the studio's
 * price field enforces and the payout ledger applies — so this page cannot
 * drift out of agreement with what an artist is actually paid.
 */
export function ForArtistsPage() {
  const store = useStore();
  const customer = useCustomer();
  usePageTitle("Open a studio");

  const { pricing, currency, locale } = store;
  const money = (cents: number) => formatMoney(cents, currency, locale);
  const isArtist = Boolean(customer.data?.artistSlug);

  /* A worked example per size, at a round price per card above the floor,
   * so the arithmetic is easy to follow and the share is never a zero. Each
   * card's part comes from `cardGrossCents`, as the ledger's does. */
  const perCardCents = Math.max(pricing.minCardPriceCents, 500);
  const examples = EDITION_SIZES.map((size) => {
    const priceCents = perCardCents * size;
    const grosses = Array.from({ length: size }, (_, i) => cardGrossCents(priceCents, size, i + 1));
    const feeCents = grosses.reduce((sum, gross) => sum + platformFeeCentsFor(gross, pricing), 0);
    const keptCents = grosses.reduce((sum, gross) => sum + artistShareCents(gross, pricing), 0);
    return { size, priceCents, printCents: pricing.printCostCents * size, feeCents, keptCents };
  });

  const studioButton = (label: string) => (
    <Link to={isArtist ? "/studio" : "/studio/new"}>
      <Button type="primary" size="large" className={cx(styles.actionButton)}>
        {isArtist ? "Go to your studio" : label}
      </Button>
    </Link>
  );

  return (
    <PageWrapper>
      <h1 className={styles.heading}>{ARTIST_PITCH.heading}</h1>
      <p className={styles.lede}>{ARTIST_PITCH.lede}</p>
      <div className={styles.lead}>{studioButton("Get started")}</div>

      <section className={styles.section}>
        <h2>How it works</h2>
        <ol className={styles.flow}>
          {ARTIST_STEPS.map((step, index) => (
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
        <div className={styles.examples}>
          {examples.map((example) => (
            <div key={example.size} className={styles.example} role="group" aria-label={`What a ${money(example.priceCents)} edition of ${example.size} pays`}>
              <h3 className={styles.exampleTitle}>
                <span className={styles.exampleCount}>{example.size}</span> cards
              </h3>
              <dl className={styles.receipt}>
                <div>
                  <dt>Edition price</dt>
                  <dd>{money(example.priceCents)}</dd>
                </div>
                <div>
                  <dt>Printing and postage</dt>
                  <dd>&minus;{money(example.printCents)}</dd>
                </div>
                <div>
                  <dt>Platform fee ({pricing.platformFeePercent}%)</dt>
                  <dd>&minus;{money(example.feeCents)}</dd>
                </div>
              </dl>
              {/* The price as a bar, with the artist's part of it lit. */}
              <div className={styles.split} aria-hidden>
                <span className={styles.splitKept} style={{ width: `${(example.keptCents / example.priceCents) * 100}%` }} />
              </div>
              <p className={styles.keep}>
                <span className={styles.keepLabel}>You keep</span>
                <span className={styles.keepAmount}>{money(example.keptCents)}</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className={cx(styles.section, styles.action)}>
        {studioButton("Open your studio")}
      </section>
    </PageWrapper>
  );
}
