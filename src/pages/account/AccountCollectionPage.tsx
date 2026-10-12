import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, App, Button, Skeleton, Tag } from "antd";
import { formatMoney } from "@shared/money";
import { artistPath, editionPath, type Collection } from "@shared/platform";
import { formatRecipient, type Recipient } from "@shared/postcards";
import { RecipientFields } from "@/components/postcard/RecipientFields";
import { useCollections, useUpdateCollectionAddress } from "@/lib/account";
import { validateRecipient, type RecipientErrors } from "@/lib/recipient-form";
import { useStore } from "@/lib/useStore";
import { customerStatusLabel, editionShape, formatDay, formatMailDate, purchaseStatusLabel } from "@/lib/postcards";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * One collection in full: where it goes, every card's day and where each
 * one is, and what was paid. This is also the receipt — the purchase is
 * written by Stripe's webhook, never by a page, and a refund shows here
 * the moment Stripe reports it.
 *
 * Found in the account's own list rather than fetched by id, so no route
 * takes a purchase id. Where it goes can be changed here, for this set
 * alone: a gift that moves, or a set that should not follow the collector
 * when they do.
 */
export function AccountCollectionPage() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const collections = useCollections();

  if (collections.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (collections.isError) return <Alert type="error" showIcon title="Your collections could not be loaded." />;

  const collection = collections.data.find((candidate) => candidate.id === id);
  if (!collection) {
    return (
      <p className={cx(styles.empty)}>
        That isn't one of your collections. <Link to="/account">Back to your collections</Link>.
      </p>
    );
  }

  return (
    <div>
      <p className={cx(styles.meta)}>
        <Link to="/account">← Collections</Link>
      </p>
      <CollectionDetail collection={collection} locale={store.locale} />
      <p className={cx(styles.meta)}>Need to stop this collection early? Get in touch and we'll refund the cards still to come.</p>
    </div>
  );
}

function CollectionDetail({ collection, locale }: { collection: Collection; locale: string }) {
  const money = (cents: number) => formatMoney(cents, collection.currency, locale);
  return (
    <section className={cx(styles.card)} aria-labelledby="collection-title">
      <div className={styles.collectionHead}>
        {collection.edition.banner ? <img className={styles.collectionBanner} src={assetUrl(collection.edition.banner.path)} alt="" width={144} height={48} /> : null}
        <div>
          <h2 id="collection-title" className={styles.collectionTitle}>
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
          <MailedTo collection={collection} locale={locale} />
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

/**
 * The address as a sentence, and — while a card is still to come — the
 * form that changes it for this set only.
 */
function MailedTo({ collection, locale }: { collection: Collection; locale: string }) {
  const update = useUpdateCollectionAddress(collection.id);
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Recipient>(collection.address);
  const [errors, setErrors] = useState<RecipientErrors>({});
  const canChange = collection.status === "paid" && collection.nextMailDate !== null;

  const submit = () => {
    const result = validateRecipient(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    update.mutate(result.value, {
      onSuccess: ({ verification }) => {
        message.success(verification.changed && verification.suggested ? "Saved. USPS knows it slightly differently; that's fine." : "Saved.");
        setEditing(false);
      },
    });
  };

  if (!editing) {
    return (
      <span className={styles.settingsRow}>
        <span>
          {collection.address.name}, {formatRecipient(collection.address, locale)}
        </span>
        {canChange ? (
          <Button size="small" onClick={() => setEditing(true)}>
            Change
          </Button>
        ) : null}
      </span>
    );
  }

  return (
    <>
      <div className={styles.addressForm}>
        <RecipientFields
          draft={draft}
          errors={errors}
          locale={locale}
          allowInternational
          onChange={(key, value) => {
            setDraft((current) => ({ ...current, [key]: value }));
            if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
          }}
        />
      </div>
      {update.isError ? <Alert className={cx(styles.alert)} type="error" showIcon title={update.error instanceof Error ? update.error.message : "Could not save."} /> : null}
      <p className={styles.actions}>
        <Button type="primary" size="small" loading={update.isPending} onClick={submit}>
          Save
        </Button>
        <Button type="link" size="small" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </p>
      <p className={cx(styles.meta)}>Only this set's cards still to come go to the new address. Your other collections, and the address on your account, stay as they are.</p>
    </>
  );
}
