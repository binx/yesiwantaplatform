import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, App, Button, Form, Input, Popconfirm, Skeleton, Tag } from "antd";
import { formatMoney } from "@shared/money";
import type { Subscription } from "@shared/platform";
import { useCancelSubscription, useCustomer, useCustomerLogout, useResumeSubscription, useSubscriptions, useUpdateProfile } from "@/lib/account";
import { useStore } from "@/lib/useStore";
import { formatDay, subscriptionStatusLabel } from "@/lib/postcards";
import { assetUrl } from "@/lib/store-source";
import { cx } from "@/lib/cx";
import styles from "./Account.module.css";

/**
 * The account's front page: who you are, and who you get mail from.
 *
 * The subscriptions list is the point — like a patron's page, each artist
 * with what it costs and a way out. Cancelling winds down at the period end
 * rather than stopping dead, and says so.
 */
export function AccountOverviewPage() {
  const store = useStore();
  const customer = useCustomer();
  const subscriptions = useSubscriptions();
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
            You have an artist page at <Link to={`/artist/${profile.artistSlug}`}>/artist/{profile.artistSlug}</Link>. <Link to="/studio">Open your studio</Link>.
          </p>
        ) : (
          <p className={cx(styles.meta, styles.studioLink)}>
            Are you an artist? <Link to="/studio/new">Open a studio</Link> and start sending your own.
          </p>
        )}
      </div>

      <h2>Your subscriptions</h2>
      {subscriptions.isPending ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : subscriptions.isError ? (
        <Alert type="error" showIcon title="Your subscriptions could not be loaded." />
      ) : subscriptions.data.length === 0 ? (
        <p className={cx(styles.empty)}>
          You don't get postcards from anyone yet. <Link to="/artists">Find an artist</Link>.
        </p>
      ) : (
        subscriptions.data.map((subscription) => <SubscriptionCard key={subscription.id} subscription={subscription} locale={store.locale} />)
      )}
    </div>
  );
}

function SubscriptionCard({ subscription, locale }: { subscription: Subscription; locale: string }) {
  const { message } = App.useApp();
  const cancel = useCancelSubscription();
  const resume = useResumeSubscription();
  const price = formatMoney(subscription.priceCents, subscription.currency, locale);
  const status = subscriptionStatusLabel(subscription.status, subscription.cancelAtPeriodEnd);
  const color = subscription.status === "active" && !subscription.cancelAtPeriodEnd ? "green" : subscription.status === "past_due" ? "red" : "default";
  const fail = (fallback: string) => (error: unknown) => void message.error(error instanceof Error ? error.message : fallback);

  return (
    <div className={cx(styles.card)}>
      <div className={cx(styles.cardHeader)}>
        <div className={styles.subscriptionHead}>
          {subscription.artist.avatar ? <img className={styles.avatar} src={assetUrl(subscription.artist.avatar.path)} alt="" width={48} height={48} /> : null}
          <div>
            <p>
              <Link to={`/artist/${subscription.artist.slug}`}>
                <strong>{subscription.artist.name}</strong>
              </Link>{" "}
              <Tag color={color}>{status}</Tag>
            </p>
            <p className={cx(styles.meta)}>
              {price} a month · month {Math.min(Math.max(subscription.paidMonths, 1), subscription.termMonths)} of {subscription.termMonths} · {subscription.postcardCount} card
              {subscription.postcardCount === 1 ? "" : "s"} received · since {formatDay(subscription.createdAt, locale)}
            </p>
            {subscription.status === "active" && subscription.currentPeriodEnd ? (
              <p className={cx(styles.meta)}>
                {subscription.cancelAtPeriodEnd ? "Ends" : "Renews"} {formatDay(subscription.currentPeriodEnd, locale)}
              </p>
            ) : null}
            {subscription.status === "past_due" ? <p className={cx(styles.meta)}>The last payment didn't go through. Stripe will retry; no cards go out until it does.</p> : null}
          </div>
        </div>
        <div className={cx(styles.cardActions)}>
          {subscription.status === "cancelled" ? (
            <Link to={`/subscribe/${subscription.artist.slug}`}>
              <Button size="small">Subscribe again</Button>
            </Link>
          ) : subscription.cancelAtPeriodEnd ? (
            <Button size="small" loading={resume.isPending} onClick={() => resume.mutate(subscription.id, { onError: fail("Could not resume.") })}>
              Keep it going
            </Button>
          ) : (
            <Popconfirm
              title="Stop the postcards?"
              description="You've paid for this month, so its card still comes. Nothing more is charged after that."
              okText="Cancel subscription"
              onConfirm={() => cancel.mutate(subscription.id, { onError: fail("Could not cancel.") })}
            >
              <Button size="small" danger loading={cancel.isPending}>
                Cancel
              </Button>
            </Popconfirm>
          )}
        </div>
      </div>
    </div>
  );
}
