import { useEffect } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { Alert, App, Button, Popconfirm, Tag } from "antd";
import { artistPath } from "@shared/platform";
import { formatMoney } from "@shared/money";
import { useRefreshPayoutStatus, useSetArtistStatus, useStartOnboarding, type StudioView } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

/**
 * The studio's front page: the numbers, the one switch that matters, and
 * where the money goes.
 *
 * Going live is what makes the page public and its editions collectable;
 * it is refused until an edition is on sale, because a visitor's first
 * look should have something in it to collect.
 *
 * Payouts are Stripe Connect transfers. The ledger accrues from the first
 * card whether or not onboarding is done; the button here sends the artist
 * to Stripe's hosted flow, and coming back refreshes the one flag that
 * decides whether the sweep can pay them.
 */
export function StudioOverviewPage() {
  const view = useOutletContext<StudioView>();
  const store = useStore();
  const setStatus = useSetArtistStatus();
  const onboard = useStartOnboarding();
  const refresh = useRefreshPayoutStatus();
  const [params, setParams] = useSearchParams();
  const { message } = App.useApp();
  const { artist, earnings, editionCounts } = view;

  // Back from Stripe: ask whether onboarding finished, once, then drop the flag.
  useEffect(() => {
    const flag = params.get("onboarding");
    if (!flag) return;
    refresh.mutate(undefined, {
      onSuccess: ({ payoutsEnabled }) => void message.info(payoutsEnabled ? "Stripe is ready to pay you." : "Stripe still needs something from you. Continue the setup below."),
    });
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("onboarding");
      return next;
    }, { replace: true });
    // Once, on arrival: the flag is the trigger, and it is cleared here.
  }, [params.get("onboarding")]);
  const money = (cents: number) => formatMoney(cents, earnings.currency, store.locale);
  const onSale = editionCounts.onSale;
  const pricing = view.pricing ?? store.pricing;

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
            onSale === 0
              ? "Put an edition on sale, then go live. Until then nobody can find you or collect your cards."
              : "You have an edition on sale. Go live whenever you're ready — your page becomes public and people can collect."
          }
        />
      ) : null}
      {artist.status === "live" && !artist.payoutsEnabled ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: "1.5rem" }}
          title="Set up payouts to get paid"
          description="Your earnings accrue from the first card, but nothing can be transferred until Stripe has your details. Set up payouts below."
        />
      ) : null}

      <div className={styles.stats}>
        <Stat value={String(artist.collectorCount)} label={artist.collectorCount === 1 ? "collector" : "collectors"} />
        <Stat value={String(onSale)} label={`on sale${editionCounts.draft > 0 ? ` · ${editionCounts.draft} in draft` : ""}${editionCounts.closed > 0 ? ` · ${editionCounts.closed} closed` : ""}`} />
        <Stat value={String(artist.mailedCount)} label="cards mailed" />
        <Stat value={money(earnings.pendingCents)} label="earned, not yet paid out" />
        <Stat value={money(earnings.paidCents)} label="paid out" />
      </div>

      <div className={cx(styles.panel, styles.panelAccent)}>
        <h2>{artist.status === "live" ? "You're live" : artist.status === "paused" ? "You're paused" : "Ready to go live?"}</h2>
        <p className={styles.note}>
          {artist.status === "live"
            ? `Anyone can collect your editions on sale at ${artistPath(artist.slug)}.`
            : artist.status === "paused"
              ? "Nobody new can collect. Everyone who already has keeps receiving every card."
              : onSale === 0
                ? "Going live needs an edition on sale, so your first visitor has something to collect."
                : "Your page goes public and your editions on sale can be collected."}
        </p>
        <div className={styles.actions}>
          {artist.status === "live" ? (
            <Popconfirm title="Pause new collectors?" description="Everyone who has already collected keeps receiving their cards." onConfirm={() => setStatus.mutate("paused", { onError: fail })}>
              <Button loading={setStatus.isPending}>Pause</Button>
            </Popconfirm>
          ) : (
            <Button type="primary" loading={setStatus.isPending} disabled={onSale === 0} onClick={() => setStatus.mutate("live", { onError: fail })}>
              {artist.status === "paused" ? "Go live again" : "Go live"}
            </Button>
          )}
          <Link to={editionCounts.draft + onSale + editionCounts.closed === 0 ? "/studio/editions/new" : "/studio/editions"}>
            <Button>{editionCounts.draft + onSale + editionCounts.closed === 0 ? "Start an edition" : "Your editions"}</Button>
          </Link>
          <Link to="/studio/profile">
            <Button>Edit your profile</Button>
          </Link>
        </div>
      </div>

      <div className={cx(styles.panel, artist.payoutsEnabled ? "" : styles.panelAccent)}>
        <h2>Payouts</h2>
        {artist.payoutsEnabled ? (
          <p className={styles.note}>
            Stripe is set up. Each card's share is transferred to your account within an hour of the printer accepting it. <Tag color="green">ready</Tag>
          </p>
        ) : artist.hasStripeAccount ? (
          <p className={styles.note}>You started setting up Stripe but it isn't finished. Your earnings wait here until it is.</p>
        ) : (
          <p className={styles.note}>
            To be paid, connect a Stripe account. It takes a few minutes: Stripe asks who you are and where to send the money. Your earnings accrue
            meanwhile.
          </p>
        )}
        <div className={styles.actions}>
          {!artist.payoutsEnabled ? (
            <Button
              type="primary"
              loading={onboard.isPending}
              onClick={() =>
                onboard.mutate(undefined, {
                  onSuccess: ({ url }) => window.location.assign(url),
                  onError: (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not start Stripe setup."),
                })
              }
            >
              {artist.hasStripeAccount ? "Continue Stripe setup" : "Set up payouts with Stripe"}
            </Button>
          ) : null}
          {artist.hasStripeAccount ? (
            <Button loading={refresh.isPending} onClick={() => refresh.mutate(undefined, { onSuccess: ({ payoutsEnabled }) => void message.info(payoutsEnabled ? "Ready to be paid." : "Not ready yet.") })}>
              Check status
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.panel}>
        <h2>How an edition goes</h2>
        <ol style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.6 }}>
          <li>You make an edition: 6 or 12 postcards, for one price. Put it on sale when every card is in place.</li>
          <li>A collector pays once, picks whether their cards come once or twice a month, and the day the first one goes. From then on we print and mail their cards one by one, on schedule.</li>
          <li>
            As the printer accepts each card, its part of the price is added to your earnings
            {` (less ${money(pricing.printCostCents)} to print and mail it and a ${pricing.platformFeePercent}% fee)`}. Payouts go to your Stripe account
            within the hour.
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
