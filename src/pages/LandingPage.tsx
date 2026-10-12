import type { CSSProperties, ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button, Skeleton } from "antd";
import { ARTIST_PITCH, PITCH_LINES } from "@shared/copy";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { useSiteLinks } from "@/components/layout/siteLinks";
import { ArtistTile, EditionTile } from "@/components/platform/ArtistTile";
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
 * The field of postcards behind the hero, drawn in CSS.
 *
 * A tilted plane of cards standing on end at different heights, each one
 * corrugated and lit with the platform's chroma from a different angle:
 * a stack of mail on a dark table, seen from above. Each entry is one card;
 * `col`/`row` place it on the plane, `depth` is how tall it stands, `hue`
 * turns the sweep so no two neighbours match, and `delay` staggers the
 * slow shimmer so the field never moves in lockstep. Gaps are deliberate.
 */
const FIELD: { col: number; row: number; depth: number; hue: number; delay: number }[] = [
  { col: 1, row: 1, depth: 3.5, hue: 0, delay: 0 },
  { col: 2, row: 1, depth: 6, hue: 40, delay: 1.3 },
  { col: 4, row: 1, depth: 4.5, hue: 200, delay: 2.1 },
  { col: 5, row: 1, depth: 2.5, hue: 300, delay: 0.7 },
  { col: 1, row: 2, depth: 7, hue: 120, delay: 3.2 },
  { col: 3, row: 2, depth: 3, hue: 260, delay: 1.9 },
  { col: 4, row: 2, depth: 8, hue: 20, delay: 0.4 },
  { col: 2, row: 3, depth: 5, hue: 180, delay: 2.6 },
  { col: 3, row: 3, depth: 9, hue: 330, delay: 1.1 },
  { col: 5, row: 3, depth: 4, hue: 90, delay: 3.7 },
  { col: 1, row: 4, depth: 2, hue: 220, delay: 0.9 },
  { col: 2, row: 4, depth: 6.5, hue: 60, delay: 2.9 },
  { col: 4, row: 4, depth: 3.5, hue: 150, delay: 1.6 },
  { col: 5, row: 4, depth: 7.5, hue: 280, delay: 3.4 },
  { col: 3, row: 5, depth: 5.5, hue: 10, delay: 0.2 },
  { col: 5, row: 5, depth: 3, hue: 240, delay: 2.3 },
];

function PostcardField() {
  return (
    <div className={styles.field} aria-hidden>
      <div className={styles.stage}>
        {FIELD.map((card) => (
          <div
            key={`${card.col}-${card.row}`}
            className={styles.block}
            style={
              {
                gridColumn: card.col,
                gridRow: card.row,
                "--depth": `${card.depth}rem`,
                "--hue": `${card.hue}deg`,
                "--delay": `${card.delay}s`,
              } as CSSProperties
            }
          >
            <div className={styles.blockTop} />
            <div className={styles.blockFront} />
            <div className={styles.blockSide} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The front page: yesiwantapostcard.com's pitch, with the artists you can
 * say yes to under it, and the editions on sale right now. The parts the
 * operator can edit are read from settings; the price floor is never typed
 * into prose — it is the same setting the studio enforces.
 *
 * There is no site header on this page; the hero draws the navigation
 * itself, so the first thing on screen is the wordmark and not a menu bar.
 */
export function LandingPage() {
  const store = useStore();
  const hero = store.hero;
  const artists = useArtists();
  const gallery = useGallery(8);
  const customer = useCustomer();
  const { links, accountHref, accountLabel } = useSiteLinks();
  const onSale = gallery.data?.pages[0]?.editions ?? [];
  const featured = (artists.data ?? []).slice(0, 6);

  return (
    <>
      <section className={cx(styles.hero)}>
        {hero.image ? null : <PostcardField />}
        <nav className={styles.heroNav} aria-label="Main">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={cx(styles.heroNavLink)}>
              {link.label}
            </NavLink>
          ))}
          <Link to={accountHref} className={cx(styles.heroNavLink, styles.heroNavAccount)}>
            {accountLabel}
          </Link>
        </nav>
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
          ) : null}
        </div>
      </section>

      <PageWrapper width="wide">
        <div className={cx(platform.sectionHeading, styles.sectionLead)}>
          <h2>Artists you can say yes to</h2>
        </div>
        {artists.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : featured.length === 0 ? (
          <p className={platform.empty}>No artists have gone live yet. {customer.data?.artistSlug ? <Link to="/studio">Yours could be first.</Link> : <Link to="/open-a-studio">Yours could be first.</Link>}</p>
        ) : (
          <>
            <div className={cx(platform.grid, platform.gridWide)}>
              {featured.map((artist) => (
                <ArtistTile key={artist.id} artist={artist} />
              ))}
            </div>
            <p className={styles.more}>
              <Link to="/artists" className={styles.pathAction}>
                All artists
              </Link>
            </p>
          </>
        )}

        <section id="how" className={styles.how}>
          <div className={styles.paths}>
            <div className={styles.path}>
              <p className={styles.pathKicker}>For collectors</p>
              <h2 className={styles.pathHeading}>Real mail from real artists</h2>
              <ol className={styles.steps}>
                <li>
                  <strong>Pick an edition.</strong> Find an artist whose work you'd like in the mail.
                </li>
                <li>
                  <strong>Say where and how often.</strong> Your address, your pace, and if you like, the first card's day.
                </li>
                <li>
                  <strong>Check your mailbox.</strong> A card arrives until the edition is done. Say yes to a few artists at once and they take turns.
                </li>
              </ol>
              <Link to="/artists" className={styles.pathAction}>
                Browse artists
              </Link>
            </div>
            <div className={styles.path}>
              <p className={styles.pathKicker}>For artists</p>
              <h2 className={styles.pathHeading}>{ARTIST_PITCH.heading}</h2>
              <p>{ARTIST_PITCH.lede}</p>
              <Link to="/open-a-studio" className={styles.pathAction}>
                Open a studio
              </Link>
            </div>
          </div>
        </section>

        {onSale.length > 0 ? (
          <>
            <div className={cx(platform.sectionHeading, styles.sectionLead)}>
              <h2>Postcard editions</h2>
            </div>
            <div className={cx(platform.grid, platform.gridWide)}>
              {onSale.map((edition) => (
                <EditionTile key={edition.id} edition={edition} artist={edition.artist} locale={store.locale} />
              ))}
            </div>
            <p className={styles.more}>
              <Link to="/gallery" className={styles.pathAction}>
                All editions
              </Link>
            </p>
          </>
        ) : null}

      </PageWrapper>
    </>
  );
}
