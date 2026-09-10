import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, App, Button, Card, Empty, Skeleton, Statistic, Table, Tag } from "antd";
import type { Order } from "@shared/orders";
import { formatMoney } from "@shared/money";
import {
  useEnvironment,
  useFulfilment,
  useOrders,
  useRunFulfilment,
  useSettings,
  useStoreLocale,
} from "./queries";
import { PageHeader } from "./RequireAdmin";
import { OrderStatusTag } from "./OrderStatusTag";
import { formatOrderDate } from "./orderPresentation";
import { cx } from "@/lib/cx";
import { isLocalOrigin } from "@/lib/publicUrl";
import styles from "./DashboardPage.module.css";

/**
 * Overview.
 *
 * The point of the wiring panel is that a store can be *almost* working —
 * Stripe connected, no Lob key — and the failure mode is silent: the money
 * is taken and no postcard ever goes out. That is worth saying on the first
 * screen rather than leaving it to be discovered by a customer.
 */
export function DashboardPage() {
  const { message } = App.useApp();
  const settings = useSettings();
  const orders = useOrders("all", 0);
  const environment = useEnvironment();
  const fulfilment = useFulfilment();
  const run = useRunFulfilment();
  const locale = useStoreLocale();

  useEffect(() => {
    document.title = "Overview · Admin";
  }, []);

  const paidOrders = orders.data?.orders.filter((order) => order.status !== "pending" && order.status !== "cancelled") ?? [];
  const revenue = paidOrders.reduce((total, order) => total + order.totalCents - order.refundedCents, 0);
  const currency = settings.data?.currency ?? "USD";
  const counts = fulfilment.data?.postcards ?? {};

  return (
    <>
      <PageHeader
        title="Overview"
        description={settings.data ? `Managing ${settings.data.name}.` : undefined}
        actions={
          <Button
            loading={run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: (result) =>
                  void message.info(
                    result.skipped ??
                      `${result.sent} sent, ${result.failed} to retry, ${result.parked} need attention.`,
                  ),
                onError: (error: unknown) =>
                  void message.error(error instanceof Error ? error.message : "Could not run the sweep."),
              })
            }
          >
            Send due postcards now
          </Button>
        }
      />

      {environment.data ? <Wiring environment={environment.data} /> : null}

      {(counts.error ?? 0) > 0 ? (
        <Alert
          className={cx(styles.wiring)}
          type="error"
          showIcon
          title={`${counts.error} postcard${counts.error === 1 ? "" : "s"} failed to send`}
          description={
            <>
              Lob refused them and the reason is on each order. Filter the{" "}
              <Link to="/admin/orders?status=paid">orders in progress</Link> and look for the failed
              count.
            </>
          }
        />
      ) : null}

      <div className={cx(styles.stats)}>
        <Card>
          <Statistic title="Scheduled" value={counts.scheduled ?? 0} loading={fulfilment.isPending} />
          <p className={cx(styles.statNote)}>Postcards waiting for their day</p>
        </Card>
        <Card>
          <Statistic title="Sent" value={counts.sent ?? 0} loading={fulfilment.isPending} />
          <p className={cx(styles.statNote)}>Handed to Lob, all time</p>
        </Card>
        <Card>
          <Statistic title="Orders" value={orders.data?.total ?? 0} loading={orders.isPending} />
        </Card>
        <Card>
          <Statistic title="Recent revenue" value={formatMoney(revenue, currency, locale)} loading={orders.isPending} />
          <p className={cx(styles.statNote)}>
            {paidOrders.length === 0
              ? "No paid orders yet"
              : `Across the most recent ${paidOrders.length} paid order${paidOrders.length === 1 ? "" : "s"}, after refunds`}
          </p>
        </Card>
      </div>

      <Card className={cx(styles.recent)} title="Recent orders" extra={<Link to="/admin/orders">All orders</Link>}>
        {orders.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (orders.data?.orders.length ?? 0) === 0 ? (
          <Empty description="No orders yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<Order>
            dataSource={orders.data?.orders.slice(0, 5)}
            rowKey="id"
            pagination={false}
            size="middle"
            scroll={{ x: "max-content" }}
            columns={[
              {
                title: "Reference",
                dataIndex: "reference",
                render: (reference: string, order) => <Link to={`/admin/orders/${order.id}`}>{reference}</Link>,
              },
              { title: "Email", dataIndex: "email" },
              { title: "Postcards", dataIndex: "postcardCount", align: "right" },
              {
                title: "Status",
                dataIndex: "status",
                render: (_value, order) => <OrderStatusTag order={order} locale={locale} />,
              },
              {
                title: "Total",
                dataIndex: "totalCents",
                align: "right",
                render: (cents: number, order) => formatMoney(cents, order.currency, locale),
              },
              {
                title: "Placed",
                dataIndex: "createdAt",
                render: (value: number) => formatOrderDate(value, false, locale),
              },
            ]}
          />
        )}
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

/** Exported for its own test: a truth table over the environment. */
export function Wiring({ environment }: WiringProps) {
  const notices: Notice[] = [];

  if (environment.production && isLocalOrigin(environment.publicUrl)) {
    notices.push({
      type: "warning",
      title: "Public URL is localhost",
      description: `Stripe will send buyers back to ${environment.publicUrl} after paying, and emailed links will not open. Set PUBLIC_URL to this store's real address and restart the API.`,
    });
  }

  if (!environment.hasStripeSecret) {
    notices.push({
      type: "info",
      title: "Stripe is not connected",
      description: "The designer works, but nothing can be sold. Set STRIPE_SECRET_KEY in .env and restart the API.",
    });
  } else if (environment.stripeKeyStatus === "invalid") {
    notices.push({
      type: "error",
      title: "The Stripe key on the server was rejected",
      description: "Replace STRIPE_SECRET_KEY and restart the API.",
    });
  } else if (!environment.hasWebhookSecret) {
    notices.push({
      type: "warning",
      title: "Stripe is connected, but webhooks are not",
      description:
        "The webhook is the only thing that marks an order paid — the success redirect proves nothing. Without STRIPE_WEBHOOK_SECRET a real payment will succeed at Stripe and no postcard will ever be scheduled.",
    });
  }

  if (environment.hasStripeSecret && environment.stripeMode === "live") {
    notices.push({ type: "warning", title: "Stripe live mode", description: "Checkouts charge real cards." });
  }

  if (!environment.hasLob) {
    notices.push({
      type: "error",
      title: "Lob is not connected, so nothing goes to print",
      description:
        "Paid orders will sit at Scheduled. Set LOB_API_KEY in .env and restart the API, then send a test postcard from Settings → Printing.",
    });
  } else if (environment.lobMode === "test" && environment.stripeMode === "live") {
    notices.push({
      type: "error",
      title: "Stripe is live but Lob is in test mode",
      description: "Real money is being taken and no real postcards are being printed. Swap in a live_ Lob key.",
    });
  } else if (environment.lobMode === "live") {
    notices.push({ type: "warning", title: "Lob live mode", description: "Every card the sweep sends is printed and mailed, and costs money." });
  }

  if (!environment.hasEmail) {
    notices.push({
      type: "info",
      title: "No email provider",
      description: "Order confirmations and 'your postcard was mailed' notices are logged instead of sent. Set SMTP_URL and EMAIL_FROM when you are ready.",
    });
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
              Everything is wired up{" "}
              <Tag color={environment.stripeMode === "live" ? "red" : "blue"}>Stripe {environment.stripeMode}</Tag>
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
