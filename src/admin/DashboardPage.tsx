import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, App, Button, Card, Statistic, Tag } from "antd";
import { formatMoney } from "@shared/money";
import { useEnvironment, useOverview, useRunFulfilment, useRunPayouts, useSettings, useStoreLocale } from "./queries";
import { PageHeader } from "./RequireAdmin";
import { cx } from "@/lib/cx";
import { isLocalOrigin } from "@/lib/publicUrl";
import styles from "./DashboardPage.module.css";

/**
 * Overview.
 *
 * The point of the wiring panel is that a platform can be *almost* working —
 * Stripe connected, no Lob key — and the failure mode is silent: the money
 * is taken and no postcard ever goes out. That is worth saying on the first
 * screen rather than leaving it to be discovered by a collector.
 */
export function DashboardPage() {
  const { message } = App.useApp();
  const settings = useSettings();
  const overview = useOverview();
  const environment = useEnvironment();
  const run = useRunFulfilment();
  const payouts = useRunPayouts();
  const locale = useStoreLocale();


  const currency = settings.data?.currency ?? "USD";
  const money = (cents: number) => formatMoney(cents, currency, locale);
  const o = overview.data;
  const fail = (error: unknown) => void message.error(error instanceof Error ? error.message : "Could not run that.");

  return (
    <>
      <PageHeader
        title="Overview"
        description={settings.data ? `Running ${settings.data.name}.` : undefined}
        actions={
          <>
            <Button
              loading={run.isPending}
              onClick={() =>
                run.mutate(undefined, {
                  onSuccess: (result) => void message.info(result.skipped ?? `${result.sent} sent, ${result.failed} to retry, ${result.parked} need attention.`),
                  onError: fail,
                })
              }
            >
              Run the mail sweep now
            </Button>
            <Button loading={payouts.isPending} onClick={() => payouts.mutate(undefined, { onSuccess: (result) => void message.info(result.skipped ?? `${result.paid} paid, ${result.deferred} deferred, ${result.failed} failed.`), onError: fail })}>
              Run payouts now
            </Button>
          </>
        }
      />

      {environment.data ? <Wiring environment={environment.data} /> : null}

      {o?.lastSweep?.result.skipped ? (
        <Alert className={cx(styles.wiring)} type="warning" showIcon title="The last mail sweep stopped early" description={`${o.lastSweep.result.skipped} (${new Date(o.lastSweep.at).toLocaleTimeString(locale)})`} />
      ) : null}

      {(o?.postcards.error ?? 0) > 0 ? (
        <Alert
          className={cx(styles.wiring)}
          type="error"
          showIcon
          title={`${o?.postcards.error} postcard${o?.postcards.error === 1 ? "" : "s"} failed to send`}
          description={
            <>
              Lob refused them and the reason is on each. <Link to="/admin/editions">See the editions</Link>.
            </>
          }
        />
      ) : null}

      {(o?.payouts.failed ?? 0) > 0 ? (
        <Alert className={cx(styles.wiring)} type="error" showIcon title={`${money(o?.payouts.failed ?? 0)} in payouts failed`} description={<Link to="/admin/payouts?status=failed">See the payouts</Link>} />
      ) : null}

      <div className={cx(styles.stats)}>
        <Card>
          <Statistic title="Live artists" value={o?.artists.live ?? 0} loading={overview.isPending} />
          <p className={cx(styles.statNote)}>
            {o?.artists.draft ?? 0} drafting · {o?.artists.paused ?? 0} paused
          </p>
        </Card>
        <Card>
          <Statistic title="Editions on sale" value={o?.editions.on_sale ?? 0} loading={overview.isPending} />
          <p className={cx(styles.statNote)}>
            {o?.editions.draft ?? 0} drafting · {o?.editions.closed ?? 0} closed
          </p>
        </Card>
        <Card>
          <Statistic title="Purchases" value={o?.purchases.paid ?? 0} loading={overview.isPending} />
          <p className={cx(styles.statNote)}>
            {o?.purchases.incomplete ?? 0} confirming · {o?.purchases.refunded ?? 0} refunded
          </p>
        </Card>
        <Card>
          <Statistic title="Postcards mailed" value={o?.postcards.sent ?? 0} loading={overview.isPending} />
          <p className={cx(styles.statNote)}>
            {o?.postcards.scheduled ?? 0} still to come · {o?.postcards.cancelled ?? 0} withdrawn
          </p>
        </Card>
        <Card>
          <Statistic title="Revenue" value={money(o?.revenueCents ?? 0)} loading={overview.isPending} />
          <p className={cx(styles.statNote)}>What collectors paid, less refunds</p>
        </Card>
        <Card>
          <Statistic title="Owed to artists" value={money(o?.payouts.pending ?? 0)} loading={overview.isPending} />
          <p className={cx(styles.statNote)}>{money(o?.payouts.paid ?? 0)} paid out so far</p>
        </Card>
      </div>

      <Card className={cx(styles.recent)} title="The economics" extra={<Link to="/admin/settings">Settings</Link>}>
        {settings.data ? (
          <p style={{ margin: 0 }}>
            Every sent card earns its artist that card's share of the edition's price, less <strong>{money(settings.data.pricing.printCostCents)}</strong> to print and mail and a{" "}
            <strong>{settings.data.pricing.platformFeePercent}%</strong> platform fee on what is left. An edition may cost no less than{" "}
            <strong>{money(settings.data.pricing.minCardPriceCents)}</strong> a card: {money(settings.data.pricing.minCardPriceCents * 6)} for six, {money(settings.data.pricing.minCardPriceCents * 12)} for twelve.
          </p>
        ) : null}
      </Card>
    </>
  );
}

interface WiringProps {
  environment: {
    hasStripeSecret: boolean;
    stripeMode: "test" | "live" | null;
    stripeKeyStatus: "valid" | "invalid" | "unchecked";
    hasWebhookSecret: boolean;
    hasEmail: boolean;
    hasLob: boolean;
    lobMode: "test" | "live" | null;
    hasLobWebhook: boolean;
    database: "sqlite" | "postgres";
    publicUrl: string;
    production: boolean;
  };
}

interface Notice {
  type: "info" | "warning" | "error";
  title: string;
  description: ReactNode;
}

/** A truth table over the environment. */
export function Wiring({ environment }: WiringProps) {
  const notices: Notice[] = [];

  if (environment.production && isLocalOrigin(environment.publicUrl)) {
    notices.push({
      type: "warning",
      title: "Public URL is localhost",
      description: `Stripe will send collectors back to ${environment.publicUrl} after paying, and emailed links will not open. Set PUBLIC_URL to the platform's real address and restart the API.`,
    });
  }

  if (!environment.hasStripeSecret) {
    notices.push({ type: "info", title: "Stripe is not connected", description: "Artists can build pages and editions, but nobody can collect one and nobody can be paid. Set STRIPE_SECRET_KEY in .env and restart the API." });
  } else if (environment.stripeKeyStatus === "invalid") {
    notices.push({ type: "error", title: "The Stripe key on the server was rejected", description: "Replace STRIPE_SECRET_KEY and restart the API." });
  } else if (!environment.hasWebhookSecret) {
    notices.push({
      type: "warning",
      title: "Stripe is connected, but webhooks are not",
      description: "The webhook is the only thing that confirms a purchase and writes its cards. Without STRIPE_WEBHOOK_SECRET a real payment will succeed at Stripe and nobody will ever get a card. Point a webhook at /api/webhooks/stripe and listen to Connect events too.",
    });
  }

  if (environment.hasStripeSecret && environment.stripeMode === "live") {
    notices.push({ type: "warning", title: "Stripe live mode", description: "Purchases charge real cards, and payouts move real money." });
  }

  if (!environment.hasLob) {
    notices.push({ type: "error", title: "Lob is not connected, so nothing goes to print", description: "Purchases will write cards that sit at Scheduled. Set LOB_API_KEY in .env and restart the API, then send a test postcard from Settings → Printing." });
  } else if (environment.lobMode === "test" && environment.stripeMode === "live") {
    notices.push({ type: "error", title: "Stripe is live but Lob is in test mode", description: "Real money is being taken and no real postcards are being printed. Swap in a live_ Lob key." });
  } else if (environment.lobMode === "live") {
    notices.push({ type: "warning", title: "Lob live mode", description: "Every card the sweep sends is printed and mailed, and costs money." });
  }

  if (environment.hasLob && !environment.hasLobWebhook) {
    notices.push({ type: "info", title: "Lob tracking is not connected", description: 'Cards still print and mail; collectors\' pages just stop at "Mailed". Create a webhook in the Lob dashboard pointed at /api/webhooks/lob and set LOB_WEBHOOK_SECRET.' });
  }

  if (!environment.hasEmail) {
    notices.push({ type: "info", title: "No email provider", description: "Welcome emails, 'your postcard was mailed' notices and password resets are logged instead of sent. Set SMTP_URL and EMAIL_FROM when you are ready." });
  }

  if (notices.length === 0) {
    return (
      <div className={cx(styles.wiring)}>
        <Alert
          className={cx(styles.notice)}
          type="success"
          showIcon
          title={
            <>
              Everything is wired up <Tag color={environment.stripeMode === "live" ? "red" : "blue"}>Stripe {environment.stripeMode}</Tag>
              <Tag color={environment.lobMode === "live" ? "red" : "blue"}>Lob {environment.lobMode}</Tag>
              <Tag>{environment.database}</Tag>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className={cx(styles.wiring)}>
      {notices.map((notice) => (
        <Alert key={notice.title} className={cx(styles.notice)} type={notice.type} showIcon title={notice.title} description={notice.description} />
      ))}
    </div>
  );
}
