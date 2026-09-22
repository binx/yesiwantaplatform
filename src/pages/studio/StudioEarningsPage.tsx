import { useEffect } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { Alert, App, Button, Skeleton, Tag } from "antd";
import { formatMoney } from "@shared/money";
import { useEarnings, useRefreshPayoutStatus, useStartOnboarding, type StudioView } from "@/lib/platform";
import { useStore } from "@/lib/useStore";
import { formatDay } from "@/lib/postcards";
import { cx } from "@/lib/cx";
import styles from "./Studio.module.css";

/**
 * What each card earned, and where it went.
 *
 * Payouts are Stripe Connect transfers. The ledger accrues from the first
 * card whether or not onboarding is done; the button here sends the artist
 * to Stripe's hosted flow, and coming back refreshes the one flag that
 * decides whether the sweep can pay them.
 */
export function StudioEarningsPage() {
  const view = useOutletContext<StudioView>();
  const store = useStore();
  const earnings = useEarnings();
  const onboard = useStartOnboarding();
  const refresh = useRefreshPayoutStatus();
  const [params, setParams] = useSearchParams();
  const { message } = App.useApp();
  const { artist } = view;


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

  const money = (cents: number, currency = earnings.data?.currency ?? store.currency) => formatMoney(cents, currency, store.locale);

  return (
    <div>
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
            To be paid, connect a Stripe account. It takes a few minutes: Stripe asks who you are and where to send the money. Your earnings
            accrue meanwhile.
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

      {earnings.isPending ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : earnings.isError ? (
        <Alert type="error" showIcon title="Your earnings could not be loaded." />
      ) : (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <p className={styles.statValue}>{money(earnings.data.pendingCents)}</p>
              <p className={styles.statLabel}>earned, waiting to be paid out</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statValue}>{money(earnings.data.paidCents)}</p>
              <p className={styles.statLabel}>paid out</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statValue}>{earnings.data.sentCount}</p>
              <p className={styles.statLabel}>cards mailed</p>
            </div>
          </div>

          <h2>Ledger</h2>
          {earnings.data.payouts.length === 0 ? (
            <p className={styles.empty}>Nothing yet. Each card the printer accepts adds a line here.</p>
          ) : (
            <table className={cx(styles.table)}>
              <thead>
                <tr>
                  <th scope="col">Card</th>
                  <th scope="col">Earned</th>
                  <th scope="col" className={styles.amount}>
                    Subscriber paid
                  </th>
                  <th scope="col" className={styles.amount}>
                    Printing
                  </th>
                  <th scope="col" className={styles.amount}>
                    Fee
                  </th>
                  <th scope="col" className={styles.amount}>
                    Yours
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {earnings.data.payouts.map((payout) => (
                  <tr key={payout.id}>
                    <td>{payout.postcardId.slice(0, 8)}</td>
                    <td>{formatDay(payout.createdAt, store.locale)}</td>
                    <td className={styles.amount}>{money(payout.grossCents, payout.currency)}</td>
                    <td className={styles.amount}>−{money(payout.printCostCents, payout.currency)}</td>
                    <td className={styles.amount}>−{money(payout.platformFeeCents, payout.currency)}</td>
                    <td className={styles.amount}>
                      <strong>{money(payout.amountCents, payout.currency)}</strong>
                    </td>
                    <td>
                      <Tag color={payout.status === "paid" ? "green" : payout.status === "failed" ? "red" : "blue"}>
                        {payout.status === "paid" ? `paid ${payout.paidAt ? formatDay(payout.paidAt, store.locale) : ""}` : payout.status === "failed" ? "held — we're on it" : "pending"}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
