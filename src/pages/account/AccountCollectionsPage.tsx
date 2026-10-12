import { Link } from "react-router-dom";
import { Alert, Skeleton, Tag } from "antd";
import { formatMoney } from "@shared/money";
import { artistPath, editionPath, type Collection } from "@shared/platform";
import { formatRecipient } from "@shared/postcards";
import { useCollections } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { customerStatusLabel, editionShape, formatDay, formatMailDate, purchaseStatusLabel } from "@/lib/postcards";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * Everything this person has collected, in full: which edition, where it
 * goes, every card's day and where each one is, and what they paid. This is
 * also the receipt — the purchase is written by Stripe's webhook, never by
 * a page, and a refund shows here the moment Stripe reports it.
 */
export function AccountCollectionsPage() {
  const store = useStore();
  const collections = useCollections();

  if (collections.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
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
        <CollectionDetail key={collection.id} collection={collection} locale={store.locale} />
      ))}
      <p className={cx(styles.meta)}>Need to stop a collection early? Get in touch and we'll refund the cards still to come.</p>
    </div>
  );
}

function CollectionDetail({ collection, locale }: { collection: Collection; locale: string }) {
  const money = (cents: number) => formatMoney(cents, collection.currency, locale);
  const headingId = `collection-${collection.id}`;
  return (
    <section className={cx(styles.card)} aria-labelledby={headingId}>
      <div className={styles.collectionHead}>
        {collection.edition.banner ? <img className={styles.collectionBanner} src={assetUrl(collection.edition.banner.path)} alt="" width={144} height={48} /> : null}
        <div>
          <h2 id={headingId} className={styles.collectionTitle}>
            <Link to={editionPath(collection.artist.slug, collection.edition.slug)}>{collection.edition.title}</Link>
          </h2>
          <p>
            by <Link to={artistPath(collection.artist.slug)}>{collection.artist.name}</Link>{" "}
            <Tag color={collection.status === "paid" ? "green" : "default"}>{purchaseStatusLabel(collection.status)}</Tag>
          </p>
          <p className={cx(styles.meta)}>
            {editionShape(collection.cardCount, collection.cadence)} · {collection.sentCount} of {collection.cardCount} sent
          </p>
        </div>
      </div>

      <dl className={styles.collectionFacts}>
        <dt>Starts</dt>
        <dd>{formatMailDate(collection.startDate, locale)}</dd>
        <dt>Mailed to</dt>
        <dd>
          {collection.address.name}, {formatRecipient(collection.address, locale)}
        </dd>
        <dt>Paid</dt>
        <dd>
          {money(collection.priceCents)}
          {collection.paidAt ? ` on ${formatDay(collection.paidAt, locale)}` : ""}
        </dd>
        {collection.refundedCents > 0 ? (
          <>
            <dt>Refunded</dt>
            <dd>{money(collection.refundedCents)}</dd>
          </>
        ) : null}
        <dt>Reference</dt>
        <dd>{collection.id}</dd>
      </dl>

      <table className={cx(styles.scheduleTable)}>
        <caption className="sr-only">Every card of {collection.edition.title}</caption>
        <thead>
          <tr>
            <th scope="col">Card</th>
            <th scope="col">Day</th>
            <th scope="col">Where it is</th>
          </tr>
        </thead>
        <tbody>
          {/* A card months away is not "going to print" yet; every other state reads as it does everywhere else. */}
          {collection.schedule.map((card) => (
            <tr key={card.position}>
              <td>
                {card.position} of {collection.cardCount}
              </td>
              <td>{formatMailDate(card.mailDate, locale)}</td>
              <td>{card.status === "scheduled" ? "To come" : customerStatusLabel(card.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
