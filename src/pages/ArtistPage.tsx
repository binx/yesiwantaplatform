import { Link, useParams } from "react-router-dom";
import { Alert, Button, Skeleton } from "antd";
import { artistLinkLabel } from "@shared/platform";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { EditionTile } from "@/components/platform/ArtistTile";
import { ApiError } from "@/lib/api";
import { useArtist } from "@/lib/platform";
import { useCustomer } from "@/lib/account";
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
 * The bio arrived as sanitised HTML from the server — the same allow-list a
 * site page gets — so it is rendered the same way a page is. The links are
 * the artist's own addresses and open elsewhere; `nofollow` because anyone
 * with a studio can put anything there.
 *
 * Collecting happens on each edition's own page, so this one only lists
 * them. A closed edition is still listed, for the people collecting it.
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

      <header className={cx(styles.artistHeader, !isOwner && styles.artistHeaderPlain)}>
        {artist.avatar ? (
          <img className={styles.artistAvatar} src={assetUrl(artist.avatar.path)} alt="" width={112} height={112} />
        ) : (
          <div className={styles.artistAvatar} aria-hidden />
        )}
        <div>
          <h1 className={styles.artistName}>{artist.name}</h1>
          {artist.tagline ? <p className={styles.artistTagline}>{artist.tagline}</p> : null}
          <p className={styles.artistFacts}>
            {artist.collectorCount} {artist.collectorCount === 1 ? "collector" : "collectors"} · {artist.mailedCount} card
            {artist.mailedCount === 1 ? "" : "s"} sent
          </p>
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
        </div>
        {isOwner ? (
          <div className={styles.collectBox}>
            <Link to="/studio">
              <Button size="large">This is your page — open the studio</Button>
            </Link>
          </div>
        ) : null}
      </header>

      {artist.bioHtml ? <div className={cx(pageStyles.body, styles.bio)} dangerouslySetInnerHTML={{ __html: artist.bioHtml }} /> : null}

      <div className={styles.sectionHeading}>
        <h2>Editions</h2>
      </div>
      {artist.status === "paused" ? <p className={styles.collectNote}>{artist.name} isn't taking new collectors right now. Everyone who already has, still gets every card.</p> : null}
      {editions.length === 0 ? (
        <p className={styles.empty}>No editions yet. The first one is coming.</p>
      ) : (
        <div className={styles.grid}>
          {editions.map((edition) => (
            <EditionTile key={edition.id} edition={edition} artist={{ slug: artist.slug }} locale={store.locale} />
          ))}
        </div>
      )}
    </PageWrapper>
  );
}

