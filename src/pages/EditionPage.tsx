import { Link, useParams } from "react-router-dom";
import { Alert, Button, Skeleton } from "antd";
import { formatMoney } from "@shared/money";
import { artistPath, type Collection } from "@shared/platform";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { ApiError } from "@/lib/api";
import { useEdition } from "@/lib/platform";
import { useCollections, useCustomer } from "@/lib/account";
import { editionShape } from "@/lib/postcards";
import { useStore } from "@/lib/useStore";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import { NotFoundPage } from "./NotFoundPage";
import styles from "@/components/platform/Platform.module.css";
import pageStyles from "./PagePage.module.css";

/** Whether a collection still has cards to come — the server's own test for "already collecting". */
function isRunning(collection: Collection): boolean {
  return collection.status === "paid" && collection.schedule.some((card) => card.status === "scheduled" || card.status === "sending" || card.status === "error");
}

/**
 * One edition: what it is, what it costs, and the way to collect it.
 *
 * The cards themselves are never shown here — they are a surprise, seen
 * first in the letterbox. The banner and the artist's writeup say what is
 * coming instead. The writeup arrived as sanitised HTML, like the artist's
 * bio, and is rendered the same way. A closed edition still renders — its collectors
 * still come looking — but says it is closed instead of offering itself.
 * Whether someone is already collecting it is a courtesy here; the server
 * is what refuses a second copy.
 */
export function EditionPage() {
  const { slug, edition: editionSlug } = useParams<{ slug: string; edition: string }>();
  const store = useStore();
  const page = useEdition(slug, editionSlug);
  const customer = useCustomer();
  const collections = useCollections(Boolean(customer.data));

  if (page.isPending) {
    return (
      <PageWrapper width="wide">
        <Skeleton active paragraph={{ rows: 8 }} />
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

  const { artist, edition } = page.data;
  const price = formatMoney(edition.priceCents, edition.currency, store.locale);
  const isOwner = customer.data?.artistSlug === artist.slug;
  const mine = collections.data?.some((collection) => collection.edition.id === edition.id && isRunning(collection)) ?? false;
  const collectable = edition.status === "on_sale" && artist.status === "live";

  return (
    <PageWrapper width="wide">
      {edition.banner ? (
        <img className={styles.artistBanner} src={assetUrl(edition.banner.path)} alt={edition.banner.alt} width={edition.banner.width} height={edition.banner.height} />
      ) : null}

      <header className={cx(styles.editionHeader)}>
        <div>
          <h1 className={styles.artistName}>{edition.title}</h1>
          <p className={styles.editionBy}>
            by <Link to={artistPath(artist.slug)}>{artist.name}</Link>
          </p>
          <p className={styles.artistFacts}>
            {editionShape(edition.cardCount, edition.cadence)} · {edition.collectorCount} {edition.collectorCount === 1 ? "collector" : "collectors"}
          </p>
        </div>
        <div className={styles.collectBox}>
          <p className={styles.collectPrice}>{price}</p>
          <p className={styles.collectShape}>for all {edition.cardCount}, paid once</p>
          {isOwner ? (
            <Link to={`/studio/editions/${edition.id}`}>
              <Button size="large">This is your edition — open the studio</Button>
            </Link>
          ) : mine ? (
            <>
              <p className={styles.collectNote}>You're collecting this edition.</p>
              <Link to="/account/collections">
                <Button size="large">Your collections</Button>
              </Link>
            </>
          ) : edition.status === "closed" ? (
            <p className={styles.collectNote}>Closed to new collectors. Everyone who has it still gets every card.</p>
          ) : !collectable ? (
            <p className={styles.collectNote}>{artist.name} isn't taking new collectors right now.</p>
          ) : (
            <>
              <Link to={`/collect/${artist.slug}/${edition.slug}`}>
                <Button type="primary" size="large">
                  Collect this edition
                </Button>
              </Link>
              <p className={styles.collectNote}>paid once · nothing renews · you pick when it starts</p>
            </>
          )}
        </div>
      </header>

      {edition.descriptionHtml ? <div className={cx(pageStyles.body, styles.bio)} dangerouslySetInnerHTML={{ __html: edition.descriptionHtml }} /> : null}

    </PageWrapper>
  );
}
