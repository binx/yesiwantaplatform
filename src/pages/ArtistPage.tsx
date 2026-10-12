import { Link, useParams } from "react-router-dom";
import { Alert, Button, Skeleton, Tag } from "antd";
import { formatMoney } from "@shared/money";
import { artistLinkLabel, editionPath, type ArtistPublic, type EditionSummary } from "@shared/platform";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductImage } from "@/components/ui/ProductImage";
import { ApiError } from "@/lib/api";
import { useArtist } from "@/lib/platform";
import { useCustomer } from "@/lib/account";
import { editionShape } from "@/lib/postcards";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import { NotFoundPage } from "./NotFoundPage";
import styles from "@/components/platform/Platform.module.css";
import pageStyles from "./PagePage.module.css";

/**
 * An artist's page: who they are, where else to find them, and the editions
 * they make. Never what they have sent: the cards are the surprise.
 *
 * Most artists have one or two editions, so they are not tiles in a grid
 * but features, one under another: the banner across the column, the
 * writeup, the price and the button. The artist sits beside them in a
 * column of their own, so a page with a single edition still reads as a
 * page and not a shelf with one thing on it.
 *
 * The bio arrived as sanitised HTML from the server — the same allow-list a
 * site page gets — so it is rendered the same way a page is. The links are
 * the artist's own addresses and open elsewhere; `nofollow` because anyone
 * with a studio can put anything there.
 *
 * Collecting happens on each edition's own page. A closed edition is still
 * listed, for the people collecting it.
 */
export function ArtistPage() {
  const { slug } = useParams<{ slug: string }>();
  const store = useStore();
  const page = useArtist(slug);
  const customer = useCustomer();

  if (page.isPending) {
    return (
      <PageWrapper width="wide">
        <Skeleton active avatar paragraph={{ rows: 8 }} />
      </PageWrapper>
    );
  }

  if (page.isError || !page.data) {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFoundPage />;
    return (
      <PageWrapper width="wide">
        <Alert type="error" showIcon title="This page could not be loaded." description="Try again in a moment." />
      </PageWrapper>
    );
  }

  const { artist, editions } = page.data;
  const isOwner = customer.data?.artistSlug === artist.slug;

  return (
    <PageWrapper width="wide">
      {artist.banner ? <img className={styles.artistBanner} src={assetUrl(artist.banner.path)} alt={artist.banner.alt} width={artist.banner.width} height={artist.banner.height} /> : null}

      <div className={styles.artistLayout}>
        <aside className={styles.artistAside}>
          {artist.avatar ? (
            <img className={styles.artistAvatar} src={assetUrl(artist.avatar.path)} alt="" width={112} height={112} />
          ) : (
            <div className={styles.artistAvatar} aria-hidden />
          )}
          <div>
            <h1 className={styles.artistName}>{artist.name}</h1>
          </div>
          {artist.links.length > 0 ? (
            <ul className={styles.artistLinks} aria-label={`Where else to find ${artist.name}`}>
              {artist.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                    {artistLinkLabel(link)}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {artist.bioHtml ? <div className={cx(pageStyles.body, styles.bio)} dangerouslySetInnerHTML={{ __html: artist.bioHtml }} /> : null}
          {isOwner ? (
            <Link to="/studio" className={styles.artistOwnerLink}>
              <Button size="large" block>
                This is your page — open the studio
              </Button>
            </Link>
          ) : null}
        </aside>

        <div className={styles.artistEditions}>
          {artist.status === "paused" ? (
            <p className={styles.artistPaused}>{artist.name} isn't taking new collectors right now. Everyone who already has, still gets every card.</p>
          ) : null}
          {editions.length === 0 ? (
            <div className={styles.featureEmpty}>
              <p>No editions yet. The first one is coming.</p>
            </div>
          ) : (
            editions.map((edition) => <EditionFeature key={edition.id} artist={artist} edition={edition} locale={store.locale} />)
          )}
        </div>
      </div>
    </PageWrapper>
  );
}

/**
 * One edition, given the room it deserves: the banner across the column,
 * then the title, the writeup and a box with the price and the way in. The
 * banner and the title both go to the edition's page; the box's button goes
 * straight to collecting. No banner, no picture: the cards are a surprise,
 * so there is nothing else to show, and the words take the whole width.
 */
function EditionFeature({ artist, edition, locale }: { artist: ArtistPublic; edition: EditionSummary; locale: string }) {
  const to = editionPath(artist.slug, edition.slug);
  const collectable = edition.status === "on_sale" && artist.status === "live";
  return (
    <article className={styles.feature} aria-labelledby={`edition-${edition.id}`}>
      {edition.banner ? (
        <Link to={to} className={styles.featureBanner} tabIndex={-1} aria-hidden>
          <ProductImage image={edition.banner} ratio={3} sizes="(max-width: 800px) 100vw, 60vw" decorative />
        </Link>
      ) : null}
      <div className={styles.featureBody}>
        <div className={styles.featureWords}>
          <h2 className={styles.featureTitle} id={`edition-${edition.id}`}>
            <Link to={to}>{edition.title}</Link>
            {edition.status === "closed" ? <Tag className={cx(styles.closedTag)}>Closed</Tag> : null}

          </h2>
          <p className={styles.artistFacts}>
            {editionShape(edition.cardCount)}
          </p>
          {edition.descriptionHtml ? <div className={cx(pageStyles.body, styles.featureDescription)} dangerouslySetInnerHTML={{ __html: edition.descriptionHtml }} /> : null}
          <p className={styles.featureMore}>
            <Link to={to}>About this edition</Link>
          </p>
        </div>
        <div className={styles.collectBox}>
          <p className={styles.collectPrice}>{formatMoney(edition.priceCents, edition.currency, locale)}</p>
          {edition.status === "closed" ? (
            <p className={styles.collectNote}>Closed to new collectors.</p>
          ) : collectable ? (
            <Link to={`/collect/${artist.slug}/${edition.slug}`}>
              <Button type="primary" size="large">
                Collect this edition
              </Button>
            </Link>
          ) : (
            <p className={styles.collectNote}>Not taking new collectors right now.</p>
          )}
        </div>
      </div>
    </article>
  );
}
