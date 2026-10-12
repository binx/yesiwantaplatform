import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Form, Input, Skeleton, Tag } from "antd";
import { artistPath, editionPath, type Collection } from "@shared/platform";
import { useCollections, useCustomer, useCustomerLogout, useUpdateProfile } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { editionShape, formatShortDate, purchaseStatusLabel } from "@/lib/postcards";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * The account's front page: who you are, and what you're collecting.
 *
 * Each collection is one line of progress — how many cards have gone, when
 * the next one does. There is nothing to cancel: an edition is paid for once
 * and ends on its own, and a refund is something the platform does.
 */
export function AccountOverviewPage() {
  const store = useStore();
  const customer = useCustomer();
  const collections = useCollections();
  const update = useUpdateProfile();
  const logout = useCustomerLogout();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);


  if (!customer.data) return null;
  const profile = customer.data;

  return (
    <div>
      <div className={cx(styles.card)}>
        <div className={cx(styles.cardHeader)}>
          <div>
            <p>
              <strong>{profile.name ?? "No name set"}</strong>
            </p>
            <p className={cx(styles.meta)}>
              {profile.email} {profile.emailVerified ? <Tag color="green">Verified</Tag> : <Tag color="gold">Not verified</Tag>}
            </p>
          </div>
          <div className={cx(styles.cardActions)}>
            {profile.artistSlug ? (
              <Link to="/studio">
                <Button type="primary" size="small">
                  Your studio
                </Button>
              </Link>
            ) : null}
            <Button size="small" onClick={() => setEditing((v) => !v)}>
              {editing ? "Cancel" : "Edit name"}
            </Button>
            <Button size="small" loading={logout.isPending} onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate("/") })}>
              Sign out
            </Button>
          </div>
        </div>
        {editing ? (
          <Form
            layout="inline"
            initialValues={{ name: profile.name ?? "" }}
            onFinish={(values: { name: string }) => update.mutate({ name: values.name.trim() || null }, { onSuccess: () => setEditing(false) })}
          >
            <Form.Item name="name" label="Name">
              <Input autoFocus />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={update.isPending}>
              Save
            </Button>
          </Form>
        ) : null}
        {profile.artistSlug ? (
          <p className={cx(styles.meta, styles.studioLink)}>
            Your artist page is at <Link to={`/artist/${profile.artistSlug}`}>/artist/{profile.artistSlug}</Link>. Editions, collectors and payouts are in <Link to="/studio">your studio</Link>.
          </p>
        ) : (
          <p className={cx(styles.meta, styles.studioLink)}>
            Are you an artist? <Link to="/studio/new">Open a studio</Link> and make your own edition.
          </p>
        )}
      </div>

      <h2>Your collections</h2>
      {collections.isPending ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : collections.isError ? (
        <Alert type="error" showIcon title="Your collections could not be loaded." />
      ) : collections.data.length === 0 ? (
        <p className={cx(styles.empty)}>
          You haven't collected anything yet. <Link to="/artists">Find an artist</Link>.
        </p>
      ) : (
        <>
          {collections.data.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} locale={store.locale} />
          ))}
          <p className={cx(styles.meta)}>
            The whole schedule, and what you paid, is under <Link to="/account/collections">Collections</Link>.
          </p>
        </>
      )}
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
            <Link to={editionPath(collection.artist.slug, collection.edition.slug)}>
              <strong>{collection.edition.title}</strong>
            </Link>{" "}
            by <Link to={artistPath(collection.artist.slug)}>{collection.artist.name}</Link> <Tag color={color}>{purchaseStatusLabel(collection.status)}</Tag>
          </p>
          <p className={cx(styles.meta)}>
            {editionShape(collection.cardCount, collection.cadence)} · {progress(collection, locale)}
          </p>
        </div>
      </div>
    </div>
  );
}
