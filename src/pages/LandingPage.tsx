import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "antd";
import { formatMoney } from "@shared/money";
import { DELIVERY_ESTIMATE } from "@shared/copy";
import { COUNTRY_CODES } from "@shared/countries";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./LandingPage.module.css";

/**
 * The hero's call to action: a router `Link` for a path and a plain anchor
 * for an absolute URL. `heroHrefSchema` has already refused everything that
 * is neither, so this is a two-way branch and not a validation.
 */
function HeroButton({ href, children }: { href: string; children: ReactNode }) {
  const button = (
    <Button type="primary" size="large">
      {children}
    </Button>
  );

  if (href.startsWith("/")) return <Link to={href}>{button}</Link>;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {button}
    </a>
  );
}

/**
 * The front page: v1's copy, with the parts the admin can edit read from
 * settings. The price is never typed into prose — it is the same setting
 * checkout charges, formatted the same way.
 */
export function LandingPage() {
  const store = useStore();
  const hero = store.hero;
  const price = formatMoney(store.postcardPriceCents, store.currency, store.locale);
  const internationalPrice =
    store.internationalPostcardPriceCents != null
      ? formatMoney(store.internationalPostcardPriceCents, store.currency, store.locale)
      : null;
  const image = hero.image ? assetUrl(hero.image.path) : "/hero.jpg";

  return (
    <>
      <section className={cx(styles.hero)}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle}>{hero.heading ?? store.name}</h1>
            <p className={styles.heroText}>
              {hero.text ?? "Design your own postcards, send them to the people you love, and schedule them to arrive every few days."}
            </p>
            <ul className={styles.points}>
              <li className={styles.magenta}>
                <strong>Create and send a postcard for {price}.</strong>
              </li>
              <li className={styles.cyan}>
                <strong>Upload your photos for the postcard designs.</strong> Write a personalized note on the back, too!
              </li>
              <li className={styles.magenta}>
                <strong>Send your cards to multiple addresses.</strong> Share photos with your friends and family!
              </li>
              <li className={styles.cyan}>
                <strong>Schedule how often to send your postcards.</strong> What's the fun in sending everything at once? Set them up to ship every few days, weeks, or months.
              </li>
            </ul>
            <HeroButton href={hero.buttonHref ?? "/create"}>
              {hero.buttonLabel ?? "Let's go, I'm sold already"}
            </HeroButton>
          </div>
          <img
            className={styles.heroImage}
            src={image}
            alt={hero.image?.alt ?? "A stack of printed postcards"}
            width={hero.image?.width ?? 400}
            height={hero.image?.height ?? 600}
            fetchPriority="high"
          />
        </div>
      </section>

      <PageWrapper>
        <div className={styles.columns}>
          <section className={styles.column}>
            <h2 className={styles.script}>Information</h2>
            <dl className={styles.faq}>
              <dt>How much do these cost?</dt>
              <dd>Each postcard costs {price}. No add-ons, no upsells.</dd>
              <dt>How long do they take to be delivered?</dt>
              <dd>{DELIVERY_ESTIMATE}</dd>
              <dt>Where can I send them to?</dt>
              <dd>
                {internationalPrice
                  ? `Anywhere in the United States, and to ${COUNTRY_CODES.length - 1} other countries — international cards cost ${internationalPrice} and take about two weeks longer.`
                  : "Anywhere in the United States, thanks to the USPS! Apologies to our international customers — we have yet to find a well-priced global postcard printing company."}
              </dd>
            </dl>
          </section>
          <section className={styles.column}>
            <h2 className={styles.script}>Inspiration</h2>
            <p>Why would you want to schedule postcards?</p>
            <p>
              Well, the reason I built this site is that my grandmother doesn't have the internet! If I
              want to share updates about my life, I need to print and mail photos for her. I thought
              it would be more fun for her to receive a postcard every few days, rather than all of
              them at once. And thus was born the idea for a postcard batch scheduler!
            </p>
          </section>
        </div>

        <p className={styles.cta}>
          <Link to="/create">
            <Button type="primary" size="large">
              Get started on your postcards
            </Button>
          </Link>
        </p>

        <img className={styles.table} src="/table.jpg" alt="" width={1600} height={600} loading="lazy" />
      </PageWrapper>
    </>
  );
}
