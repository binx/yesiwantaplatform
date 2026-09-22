import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { PITCH_LINES } from "@shared/copy";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ArtistTile, GalleryTile } from "@/components/platform/ArtistTile";
import { useArtists, useGallery } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { useCustomer } from "@/lib/account";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import platform from "@/components/platform/Platform.module.css";
import styles from "./LandingPage.module.css";

/**
 * The hero's call to action: a router `Link` for a path and a plain anchor
 * for an absolute URL. `heroHrefSchema` has already refused everything that
 * is neither, so this is a two-way branch and not a validation.
 */
function HeroButton({ href, children }: { href: string; children: ReactNode }) {
  const button = (
    <Button size="large" className={cx(styles.heroButton)}>
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
 * The front page: yesiwantapostcard.com's pitch, with the artists you can
 * say yes to under it, and what recently went out in the post. The parts the
 * operator can edit are read from settings; the price floor is never typed
 * into prose — it is the same setting the studio enforces.
 */
export function LandingPage() {
  const store = useStore();
  const hero = store.hero;
  const artists = useArtists();
  const gallery = useGallery(8);
  const customer = useCustomer();
  const floor = formatMoney(store.pricing.minMonthlyPriceCents, store.currency, store.locale);
  const recent = gallery.data?.pages[0]?.cards ?? [];
  const featured = (artists.data ?? []).slice(0, 6);

  return (
    <>
      <section className={cx(styles.hero)}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <h1 className={styles.wordmark}>
              <span className={styles.yes}>{hero.heading ?? "yes"}</span>
              {hero.heading ? null : <span className={styles.rest}>i want a postcard</span>}
            </h1>
            <p className={styles.heroText}>{hero.text ?? "an artist would like to send you a postcard."}</p>
            <ul className={styles.points}>
              {PITCH_LINES.map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>from {floor} a month, once a month, straight to your letterbox</li>
            </ul>
            <div className={styles.heroActions}>
              <HeroButton href={hero.buttonHref ?? "/artists"}>{hero.buttonLabel ?? "YES I WANT A POSTCARD"}</HeroButton>
              <Link to="#how" className={styles.heroAside}>
                How it works
              </Link>
            </div>
          </div>
          {hero.image ? (
            <img className={styles.heroImage} src={assetUrl(hero.image.path)} alt={hero.image.alt} width={hero.image.width} height={hero.image.height} fetchPriority="high" />
          ) : (
            <div className={styles.heroCard} aria-hidden>
              <div className={styles.heroCardFront} />
              <div className={styles.heroCardBack}>
                <span className={styles.heroCardLine} />
                <span className={styles.heroCardLine} />
                <span className={styles.heroCardStamp} />
              </div>
            </div>
          )}
        </div>
      </section>

      <PageWrapper width="wide">
        <div className={platform.sectionHeading}>
          <h2>Artists you can say yes to</h2>
          <Link to="/artists">All artists</Link>
        </div>
        {artists.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : featured.length === 0 ? (
          <p className={platform.empty}>No artists have gone live yet. {customer.data?.artistSlug ? <Link to="/studio">Yours could be first.</Link> : <Link to="/studio/new">Yours could be first.</Link>}</p>
        ) : (
          <div className={platform.grid}>
            {featured.map((artist) => (
              <ArtistTile key={artist.id} artist={artist} locale={store.locale} />
            ))}
          </div>
        )}

        <section id="how" className={styles.how}>
          <div className={styles.paths}>
            <div className={styles.path}>
              <p className={styles.pathKicker}>For subscribers</p>
              <h2 className={styles.pathHeading}>Add a little mail magic to your life</h2>
              <p>
                An artist you like takes photos, makes pictures, goes places. Instead of posting them, once a month they mail one
                to everyone who said yes: a real postcard, with a photo they took on the front and a short note on the back.
              </p>
              <ol className={styles.steps}>
                <li>
                  <strong>Pick an artist.</strong> Each sets their own monthly price.
                </li>
                <li>
                  <strong>Give us your address.</strong> Once. Change it anytime.
                </li>
                <li>
                  <strong>Check your letterbox.</strong> Around the same day each month, a card arrives. Cancel whenever; you won't
                  hurt anyone's feelings.
                </li>
              </ol>
              <Link to="/artists" className={styles.pathAction}>
                Find an artist
              </Link>
            </div>
            <div className={styles.path}>
              <p className={styles.pathKicker}>For artists</p>
              <h2 className={styles.pathHeading}>Share your art, build an audience</h2>
              <p>
                Your best work deserves better than a feed. Once a month, put one picture and a few words in the hands of the people
                who want to hear from you — no algorithm, nothing online, just a card that arrives.
              </p>
              <ol className={styles.steps}>
                <li>
                  <strong>Open a studio.</strong> Make your page and set your own monthly price.
                </li>
                <li>
                  <strong>Queue a card a month.</strong> A photo on the front, your note on the back.
                </li>
                <li>
                  <strong>We do the rest.</strong> We print it, mail it to every subscriber, and pay you the difference after
                  printing and a small fee.
                </li>
              </ol>
              <Link to="/studio/new" className={styles.pathAction}>
                Open a studio
              </Link>
            </div>
          </div>
        </section>

        {recent.length > 0 ? (
          <>
            <div className={platform.sectionHeading}>
              <h2>Recently in the post</h2>
              <Link to="/gallery">The gallery</Link>
            </div>
            <div className={platform.galleryGrid}>
              {recent.map((card) => (
                <GalleryTile key={card.mailingId} card={card} locale={store.locale} />
              ))}
            </div>
          </>
        ) : null}
      </PageWrapper>
    </>
  );
}
