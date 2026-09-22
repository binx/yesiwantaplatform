import { Link, useParams } from "react-router-dom";
import { Alert, Button, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { GalleryTile } from "@/components/platform/ArtistTile";
import { ApiError } from "@/lib/api";
import { useArtist } from "@/lib/platform";
import { useCustomer, useSubscriptions } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import { NotFoundPage } from "./NotFoundPage";
import styles from "@/components/platform/Platform.module.css";
import pageStyles from "./PagePage.module.css";

/**
 * An artist's page: who they are, what a month costs, what they have sent.
 *
 * The bio arrived as sanitised HTML from the server — the same allow-list a
 * site page gets — so it is rendered the same way a page is.
 */
export function ArtistPage() {
  const { slug } = useParams<{ slug: string }>();
  const store = useStore();
  const page = useArtist(slug);
  const customer = useCustomer();
  const subscriptions = useSubscriptions(Boolean(customer.data));


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

  const { artist, recent } = page.data;
  const price = formatMoney(artist.monthlyPriceCents, artist.currency, store.locale);
  const mine = subscriptions.data?.find((s) => s.artist.id === artist.id && s.status !== "cancelled");
  const isOwner = customer.data?.artistSlug === artist.slug;
  const ordinal = (day: number) => `${day}${day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th"}`;

  return (
    <PageWrapper width="wide">
      <header className={cx(styles.artistHeader)}>
        {artist.avatar ? (
          <img className={styles.artistAvatar} src={assetUrl(artist.avatar.path)} alt="" width={112} height={112} />
        ) : (
          <div className={styles.artistAvatar} aria-hidden />
        )}
        <div>
          <h1 className={styles.artistName}>{artist.name}</h1>
          {artist.tagline ? <p className={styles.artistTagline}>{artist.tagline}</p> : null}
          <p className={styles.artistFacts}>
            {artist.subscriberCount} {artist.subscriberCount === 1 ? "person gets" : "people get"} their mail · {artist.mailedCount} card
            {artist.mailedCount === 1 ? "" : "s"} sent · goes out around the {ordinal(artist.sendDay)} of the month
          </p>
        </div>
        <div className={styles.subscribeBox}>
          <p className={styles.subscribePrice}>{price} a month</p>
          {isOwner ? (
            <Link to="/studio">
              <Button size="large">This is your page — open the studio</Button>
            </Link>
          ) : mine ? (
            <>
              <p className={styles.subscribeNote}>You already get {artist.name}'s postcards.</p>
              <Link to="/account">
                <Button size="large">Your subscriptions</Button>
              </Link>
            </>
          ) : artist.status === "paused" ? (
            <p className={styles.subscribeNote}>{artist.name} isn't taking new subscribers right now.</p>
          ) : (
            <>
              <Link to={`/subscribe/${artist.slug}`}>
                <Button type="primary" size="large">
                  YES I WANT A POSTCARD
                </Button>
              </Link>
              <p className={styles.subscribeNote}>one postcard a month · cancel anytime</p>
            </>
          )}
        </div>
      </header>

      {artist.bioHtml ? <div className={cx(pageStyles.body, styles.bio)} dangerouslySetInnerHTML={{ __html: artist.bioHtml }} /> : null}

      <div className={styles.sectionHeading}>
        <h2>Recently mailed</h2>
      </div>
      {recent.length === 0 ? (
        <p className={styles.empty}>Nothing has gone out yet. The first card is coming.</p>
      ) : (
        <div className={styles.galleryGrid}>
          {recent.map((card) => (
            <GalleryTile key={card.mailingId} card={card} locale={store.locale} showArtist={false} />
          ))}
        </div>
      )}
    </PageWrapper>
  );
}
