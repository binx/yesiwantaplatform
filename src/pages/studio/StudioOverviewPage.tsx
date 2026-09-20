import { useEffect } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Alert, App, Button, Popconfirm } from "antd";
import { formatMoney } from "@shared/money";
import { useSetArtistStatus, type StudioView } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { formatMailDate } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

/**
 * The studio's front page: the numbers, and the one switch that matters.
 *
 * Going live is what makes the page public and subscribable; it is refused
 * until there is a card in the queue, because a subscriber's first month
 * should have something in it.
 */
export function StudioOverviewPage() {
  const view = useOutletContext<StudioView>();
  const store = useStore();
  const setStatus = useSetArtistStatus();
  const { message } = App.useApp();
  const { artist, earnings } = view;
  const money = (cents: number) => formatMoney(cents, earnings.currency, store.locale);

  useEffect(() => {
    document.title = `Studio · ${store.name}`;
  }, [store.name]);

  const fail = (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not change that.");

  return (
    <div>
      {artist.status === "draft" ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: "1.5rem" }}
          title="Your page is a draft"
          description={
            view.queuedCount === 0
              ? "Queue at least one postcard, then go live. Until then nobody can find or subscribe to you."
              : "You have a card queued. Go live whenever you're ready — your page becomes public and people can subscribe."
          }
        />
      ) : null}
      {artist.status === "live" && !artist.payoutsEnabled ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: "1.5rem" }}
          title="Set up payouts to get paid"
          description={
            <>
              Your earnings accrue from the first card, but nothing can be transferred until Stripe has your details. <Link to="/studio/earnings">Set up payouts</Link>.
            </>
          }
        />
      ) : null}

      <div className={styles.stats}>
        <Stat value={String(artist.subscriberCount)} label={artist.subscriberCount === 1 ? "subscriber" : "subscribers"} />
        <Stat value={String(view.queuedCount)} label={view.nextQueued ? `queued · next ${formatMailDate(view.nextQueued, store.locale)}` : "queued"} />
        <Stat value={String(artist.mailedCount)} label="cards mailed" />
        <Stat value={money(earnings.pendingCents)} label="earned, not yet paid out" />
        <Stat value={money(earnings.paidCents)} label="paid out" />
      </div>

      <div className={cx(styles.panel, styles.panelAccent)}>
        <h2>{artist.status === "live" ? "You're live" : artist.status === "paused" ? "You're paused" : "Ready to go live?"}</h2>
        <p className={styles.note}>
          {artist.status === "live"
            ? `Anyone can subscribe at /a/${artist.slug} for ${formatMoney(artist.monthlyPriceCents, artist.currency, store.locale)} a month. Each card you send earns you ${view.shareCents === null ? "your share" : money(view.shareCents)} per subscriber.`
            : artist.status === "paused"
              ? "No new subscribers can join. Existing ones still get every card you queue until they cancel."
              : `Your page goes public and subscribable. Each card you send will earn ${view.shareCents === null ? "your share" : money(view.shareCents)} per subscriber at your current price.`}
        </p>
        <div className={styles.actions}>
          {artist.status === "live" ? (
            <Popconfirm title="Pause new subscriptions?" description="Existing subscribers keep receiving your queued cards." onConfirm={() => setStatus.mutate("paused", { onError: fail })}>
              <Button loading={setStatus.isPending}>Pause</Button>
            </Popconfirm>
          ) : (
            <Button type="primary" loading={setStatus.isPending} disabled={view.queuedCount === 0} onClick={() => setStatus.mutate("live", { onError: fail })}>
              {artist.status === "paused" ? "Go live again" : "Go live"}
            </Button>
          )}
          <Link to="/studio/queue">
            <Button>{view.queuedCount === 0 ? "Queue a postcard" : "Your queue"}</Button>
          </Link>
          <Link to="/studio/profile">
            <Button>Edit your page</Button>
          </Link>
        </div>
      </div>

      <div className={styles.panel}>
        <h2>How a month goes</h2>
        <ol style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.6 }}>
          <li>You queue a card: a photo on the front, a note on the back, one per calendar month.</li>
          <li>
            On its date — around the {artist.sendDay}th, unless you pick another day — one is printed and mailed to every active subscriber. We
            email you how many.
          </li>
          <li>
            As the printer accepts each card, its share is added to your earnings
            {view.pricing ? ` (your price, less ${money(view.pricing.printCostCents)} to print and mail it and a ${money(view.pricing.platformFeeCents)} fee)` : ""}. Payouts go to
            your Stripe account within the hour.
          </li>
        </ol>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <p className={styles.statValue}>{value}</p>
      <p className={styles.statLabel}>{label}</p>
    </div>
  );
}
