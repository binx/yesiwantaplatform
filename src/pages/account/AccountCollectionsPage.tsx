import { Link } from "react-router-dom";
import { Alert, Skeleton, Tag } from "antd";
import { artistPath, type Collection } from "@shared/platform";
import { useCollections } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { editionShape, formatShortDate, purchaseStatusLabel } from "@/lib/postcards";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * The account's front page: each edition this person collects, as one line
 * of progress — how many cards have gone, when the next one does, and who
 * it is mailed to, since a set can be a gift. The whole schedule and the
 * receipt are on the collection's own page.
 *
 * There is nothing to cancel: an edition is paid for once and ends on its
 * own, and a refund is something the platform does.
 */
export function AccountCollectionsPage() {
  const store = useStore();
  const collections = useCollections();

  if (collections.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (collections.isError) return <Alert type="error" showIcon title="Your collections could not be loaded." />;
  if (collections.data.length === 0) {
    return (
      <p className={cx(styles.empty)}>
        You haven't collected anything yet. <Link to="/artists">Find an artist</Link>.
      </p>
    );
  }

  return (
    <div>
      {collections.data.map((collection) => (
        <CollectionCard key={collection.id} collection={collection} locale={store.locale} />
      ))}
    </div>
  );
}

/** How far along a run is: "2 of 6 sent · next on 15 Nov". */
function progress(collection: Collection, locale: string): string {
  const sent = `${collection.sentCount} of ${collection.cardCount} sent`;
  if (collection.status === "refunded") return `${sent} · refunded`;
  if (collection.nextMailDate) return `${sent} · next on ${formatShortDate(collection.nextMailDate, locale)}`;
  return sent;
}

function CollectionCard({ collection, locale }: { collection: Collection; locale: string }) {
  const color = collection.status === "paid" ? "green" : "default";
  return (
    <div className={cx(styles.card)}>
      <div className={styles.collectionHead}>
        {collection.edition.banner ? <img className={styles.collectionBanner} src={assetUrl(collection.edition.banner.path)} alt="" width={144} height={48} /> : null}
        <div>
          <p>
            <Link to={`/account/collections/${collection.id}`}>
              <strong>{collection.edition.title}</strong>
            </Link>{" "}
            by <Link to={artistPath(collection.artist.slug)}>{collection.artist.name}</Link> <Tag color={color}>{purchaseStatusLabel(collection.status)}</Tag>
          </p>
          <p className={cx(styles.meta)}>
            {editionShape(collection.cardCount, collection.cadence)} · {progress(collection, locale)}
          </p>
          <p className={cx(styles.meta)}>Mailed to {collection.address.name}</p>
        </div>
      </div>
    </div>
  );
}
