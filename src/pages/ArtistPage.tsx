import { Link, useParams } from "react-router-dom";
import { Alert, Button, Skeleton, Tag } from "antd";
import { formatMoney } from "@shared/money";
import { KEEPS_EVERY_CARD } from "@shared/copy";
import { artistLinkLabel, editionPath, type ArtistPublic, type EditionSummary } from "@shared/platform";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ProductImage } from "@/components/ui/ProductImage";
import { ApiError } from "@/lib/api";
import { useArtist } from "@/lib/platform";
import { usePageTitle } from "@/lib/usePageTitle";
import { useCustomer } from "@/lib/account";
import { editionShape } from "@/lib/postcards";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import { NotFoundPage } from "./NotFoundPage";
import platform from "@/components/platform/Platform.module.css";
import pageStyles from "./PagePage.module.css";
import styles from "./ArtistPage.module.css";

/**
 * An artist's page: who they are, where else to find them, and the editions
 * they make. Never what they have sent: the cards are the surprise.
 *
 * Shaped like a profile, because that is what a visitor arriving from a
 * link in the artist's own feed expects: the cover across the top, the
 * face set into its bottom edge, the name and the numbers beside it, the
 * bio under, and the editions as the feed. The numbers are the ones the
 * server already gives any visitor — how many collect, how many cards have
 * gone out — and never who.
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
  usePageTitle(page.data?.artist.name);

  if (page.isPending) {
    return (
      <PageWrapper>
        <Skeleton active avatar paragraph={{ rows: 8 }} />
      </PageWrapper>
    );
  }

  if (page.isError || !page.data) {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFoundPage />;
    return (
      <PageWrapper>
        <Alert type="error" showIcon title="This page could not be loaded." description="Try again in a moment." />
      </PageWrapper>
    );
  }

  const { artist, editions } = page.data;
  const isOwner = customer.data?.artistSlug === artist.slug;
  const onSale = editions.filter((edition) => edition.status === "on_sale").length;
  const since = new Date(artist.createdAt).toLocaleDateString(store.locale, { month: "long", year: "numeric" });

  return (
    <PageWrapper>
      <header className={styles.profile}>
        <div className={styles.cover}>
          {artist.banner ? (
            <img src={assetUrl(artist.banner.path)} alt={artist.banner.alt} width={artist.banner.width} height={artist.banner.height} />
          ) : (
            <div className={styles.coverEmpty} aria-hidden />
          )}
        </div>

        <div className={styles.identity}>
          <div className={styles.avatar}>
            {artist.avatar ? (
              <img src={assetUrl(artist.avatar.path)} alt="" width={152} height={152} />
            ) : (
              <div className={styles.avatarEmpty} aria-hidden>
                {artist.name.trim().charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className={styles.who}>
            <p className={styles.kicker}>{artist.status === "paused" ? "Artist · paused" : "Artist"}</p>
            <h1 className={styles.name}>{artist.name}</h1>
            <ul className={styles.stats} aria-label={`About ${artist.name}`}>
              <li>
                {editions.length === 0 ? (
                  "No editions yet"
                ) : onSale > 0 ? (
                  <>
                    <strong>{onSale}</strong> {onSale === 1 ? "edition" : "editions"} on sale
                  </>
                ) : (
                  <>
                    <strong>{editions.length}</strong> {editions.length === 1 ? "edition" : "editions"}
                  </>
                )}
              </li>
              {artist.collectorCount > 0 ? (
                <li>
                  <strong>{artist.collectorCount.toLocaleString(store.locale)}</strong> {artist.collectorCount === 1 ? "collector" : "collectors"}
                </li>
              ) : null}
              {artist.mailedCount > 0 ? (
                <li>
                  <strong>{artist.mailedCount.toLocaleString(store.locale)}</strong> {artist.mailedCount === 1 ? "card" : "cards"} mailed
                </li>
              ) : null}
              <li>Here since {since}</li>
            </ul>
          </div>

          {artist.links.length > 0 || isOwner ? (
            <nav className={styles.actions} aria-label={`Where else to find ${artist.name}`}>
              {artist.links.map((link) => (
                <a key={link.url} className={styles.chip} href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                  {artistLinkLabel(link)}
                  <span aria-hidden>↗</span>
                </a>
              ))}
              {isOwner ? (
                <Link to="/studio" className={cx(styles.chip, styles.ownerLink)}>
                  This is your page — open the studio
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>

        {artist.bioHtml ? <div className={cx(pageStyles.body, styles.bio)} dangerouslySetInnerHTML={{ __html: artist.bioHtml }} /> : null}
      </header>

      <section className={styles.editions} aria-labelledby="editions-heading">
        <div className={styles.sectionHead}>
          <h2 id="editions-heading">Editions</h2>
          {editions.length > 0 ? (
            <span className={styles.sectionCount}>
              {onSale > 0 ? `${onSale} on sale` : "none on sale"}
              {editions.length > onSale ? ` · ${editions.length - onSale} closed` : ""}
            </span>
          ) : null}
        </div>

        {artist.status === "paused" ? (
          <p className={styles.paused}>
            {artist.name} isn't taking new collectors right now. {KEEPS_EVERY_CARD}
          </p>
        ) : null}

        {editions.length === 0 ? (
          <div className={styles.featureEmpty}>
            <p>No editions yet. The first one is coming.</p>
          </div>
        ) : (
          <div className={styles.feed}>
            {editions.map((edition) => (
              <EditionFeature key={edition.id} artist={artist} edition={edition} locale={store.locale} alone={editions.length === 1} />
            ))}
          </div>
        )}
      </section>
    </PageWrapper>
  );
}

/**
 * One edition as a post in the feed: the banner, the title, the shape, a
 * few lines of the writeup, and a foot with the price and the way in. The
 * banner and the title both go to the edition's page; the button goes
 * straight to collecting. No banner, no picture: the cards are a surprise,
 * so there is nothing else to show.
 *
 * An edition with the row to itself gets a wider, shorter banner, so one
 * post does not stand taller than the cover above it.
 */
function EditionFeature({ artist, edition, locale, alone }: { artist: ArtistPublic; edition: EditionSummary; locale: string; alone: boolean }) {
  const to = editionPath(artist.slug, edition.slug);
  const collectable = edition.status === "on_sale" && artist.status === "live";
  return (
    <article className={styles.feature} aria-labelledby={`edition-${edition.id}`}>
      {edition.banner ? (
        <Link to={to} className={styles.featureBanner} tabIndex={-1} aria-hidden>
          <ProductImage image={edition.banner} ratio={alone ? 3 : 2.2} sizes={alone ? "(max-width: 800px) 100vw, 1100px" : "(max-width: 800px) 100vw, 550px"} decorative />
        </Link>
      ) : null}
      <div className={styles.featureBody}>
        <h3 className={styles.featureTitle} id={`edition-${edition.id}`}>
          <Link to={to}>{edition.title}</Link>
          {edition.status === "closed" ? <Tag className={cx(platform.closedTag)}>Closed</Tag> : null}
        </h3>
        <p className={styles.featureShape}>{editionShape(edition.cardCount)}</p>
        {edition.descriptionHtml ? <div className={cx(pageStyles.body, styles.featureDescription)} dangerouslySetInnerHTML={{ __html: edition.descriptionHtml }} /> : <div />}
        <div className={styles.featureFoot}>
          <div className={styles.price}>
            <p className={styles.priceAmount}>{formatMoney(edition.priceCents, edition.currency, locale)}</p>
            <p className={styles.priceNote}>for the whole set</p>
          </div>
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
