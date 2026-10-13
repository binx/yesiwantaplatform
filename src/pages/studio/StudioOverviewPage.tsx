import { useEffect } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { Alert, App, Button, Popconfirm, Tag } from "antd";
import { formatMoney } from "@shared/money";
import { KEEPS_EVERY_CARD } from "@shared/copy";
import { useRefreshPayoutStatus, useRequestArtistReview, useSetArtistStatus, useStartOnboarding, type StudioView } from "@/lib/platform";
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
  const askAgain = useRequestArtistReview();
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
  const approved = artist.reviewStatus === "approved";

  const fail = (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not change that.");

  return (
    <div>
      {artist.reviewStatus === "pending" ? (
        <Alert type="info" showIcon style={{ marginBottom: "1.5rem" }} title="Your page is waiting for review" description="We'll email you once we've looked at it. You can make editions and send them for review in the meantime." />
      ) : artist.reviewStatus === "declined" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: "1.5rem" }}
          title="Your page wasn't approved"
          description={
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {artist.reviewNote ? <span style={{ whiteSpace: "pre-wrap" }}>{artist.reviewNote}</span> : null}
              <span>
                <Button size="small" loading={askAgain.isPending} onClick={() => askAgain.mutate(undefined, { onSuccess: () => void message.success("Sent for review again."), onError: fail })}>
                  Send for review again
                </Button>
              </span>
            </div>
          }
        />
      ) : null}
      {artist.status === "draft" && approved ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: "1.5rem" }}
          title="Your page is a draft"
          description={
            onSale === 0
              ? "Send an edition for review; once it's approved and on sale, go live. Until then nobody can find you or collect your cards."
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
        <Stat
          value={String(onSale)}
          label={`on sale${editionCounts.inReview > 0 ? ` · ${editionCounts.inReview} in review` : ""}${editionCounts.draft > 0 ? ` · ${editionCounts.draft} in draft` : ""}${editionCounts.closed > 0 ? ` · ${editionCounts.closed} closed` : ""}`}
        />
        <Stat value={String(artist.mailedCount)} label="cards mailed" />
        <Stat value={money(earnings.pendingCents)} label="earned, not yet paid out" />
        <Stat value={money(earnings.paidCents)} label="paid out" />
      </div>

      <div className={cx(styles.panel, styles.panelAccent)}>
        <h2>{artist.status === "live" ? "You're live" : artist.status === "paused" ? "You're paused" : "Ready to go live?"}</h2>
        <p className={styles.note}>
          {artist.status === "live"
            ? `Pausing takes you out of the directory and stops new collectors. ${KEEPS_EVERY_CARD}`
            : artist.status === "paused"
              ? `You're out of the directory and nobody new can collect. ${KEEPS_EVERY_CARD} You're paid for each one as it's mailed.`
              : !approved
                ? "Going live needs your page approved and an edition on sale, so your first visitor has something to collect."
                : onSale === 0
                  ? "Going live needs an edition on sale, so your first visitor has something to collect."
                  : "Your page goes public and your editions on sale can be collected."}
        </p>
        <div className={styles.actions}>
          {artist.status === "live" ? (
            <Popconfirm title="Pause new collectors?" onConfirm={() => setStatus.mutate("paused", { onError: fail })}>
              <Button loading={setStatus.isPending}>Pause</Button>
            </Popconfirm>
          ) : (
            <Button type="primary" loading={setStatus.isPending} disabled={!approved || onSale === 0} onClick={() => setStatus.mutate("live", { onError: fail })}>
              {artist.status === "paused" ? "Go live again" : "Go live"}
            </Button>
          )}
          {editionCounts.draft + onSale + editionCounts.closed === 0 ? (
            <Link to="/studio/editions/new">
              <Button>Start an edition</Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className={cx(styles.panel, artist.payoutsEnabled ? "" : styles.panelAccent)}>
        <h2>Payouts</h2>
        {artist.payoutsEnabled ? (
          <p className={styles.note}>
            Stripe is set up. Each card's share is transferred to your account as it is mailed. <Tag color="green">Ready</Tag>
          </p>
        ) : artist.hasStripeAccount ? (
          <p className={styles.note}>You started setting up Stripe but it isn't finished. Your earnings wait here until it is.</p>
        ) : null}
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
